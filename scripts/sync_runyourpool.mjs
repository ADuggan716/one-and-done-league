#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchRunYourPoolData,
  fetchSplashSportsData,
  loadCookie,
  normalizeSnapshot,
  parseSplashSportsHtml,
  readConfig,
  SyncError,
} from "../src/lib/sync.mjs";
import {
  buildWeeklyComparison,
  calculateWhoGainedThisWeek,
  computeLeaguePercentile,
  computeSubgroupStandings,
  computeTeamSummary,
} from "../src/lib/scoring.mjs";
import { generateRecommendations } from "../src/lib/recommendations.mjs";
import { mergeSignals, readOnlineSignals } from "../src/lib/online_signals.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);

async function captureChromeHtml(targetUrl) {
  const normalizedTargetUrl = String(targetUrl).trim();
  const lines = [
    "on run argv",
    "set targetUrl to item 1 of argv",
    'tell application "Google Chrome"',
    'if not running then error "Google Chrome is not running."',
    "set targetTab to missing value",
    "repeat with w in windows",
    "repeat with t in tabs of w",
    "set tabUrl to URL of t as text",
    "if tabUrl is targetUrl then",
    "set targetTab to t",
    "exit repeat",
    "end if",
    "end repeat",
    "if targetTab is not missing value then exit repeat",
    "end repeat",
    "end tell",
    "if targetTab is missing value then error \"No matching Chrome tab found for \" & targetUrl & \". Open the Splash page in a normal Chrome tab first.\"",
    "delay 1",
    'tell application "Google Chrome"',
    'return execute targetTab javascript "document.documentElement.outerHTML"',
    "end tell",
    "end run",
  ];

  const args = lines.flatMap((line) => ["-e", line]).concat(normalizedTargetUrl);
  const { stdout } = await execFileAsync("osascript", args);
  return stdout.trim();
}

async function fetchSplashFromChrome(config) {
  const baseUrl = config.splash.baseUrl;
  const entriesUrl = `${baseUrl.replace(/\/$/, "")}${config.splash.leaguePath}`;
  const standingsUrl = `${baseUrl.replace(/\/$/, "")}${config.splash.standingsPath}`;
  const entryIds = config.entryIds || {};

  const [entriesHtml, standingsHtml] = await Promise.all([
    captureChromeHtml(entriesUrl),
    captureChromeHtml(standingsUrl),
  ]);

  const pickHistoryEntries = await Promise.all(
    Object.entries(entryIds).map(async ([member, entryId]) => {
      const historyUrl = `${baseUrl.replace(/\/$/, "")}/Golf/PickX/modal/pickHistory.cfm?entryId=${entryId}`;
      const html = await captureChromeHtml(historyUrl);
      return [member, html];
    })
  );
  const pickHistoryByMember = Object.fromEntries(pickHistoryEntries);

  await fs.mkdir(path.join(root, "logs"), { recursive: true });
  await fs.writeFile(path.join(root, "logs/chrome-splash-entries.html"), `${entriesHtml}\n`, "utf8");
  await fs.writeFile(path.join(root, "logs/chrome-splash-standings.html"), `${standingsHtml}\n`, "utf8");
  for (const [member, html] of pickHistoryEntries) {
    await fs.writeFile(
      path.join(root, `logs/chrome-splash-history-${member.toLowerCase()}.html`),
      `${html}\n`,
      "utf8"
    );
  }

  return parseSplashSportsHtml({
    baseUrl: config.splash.baseUrl,
    leaguePath: config.splash.leaguePath,
    standingsPath: config.splash.standingsPath,
    subgroupMembers: config.subgroupMembers,
    memberAliases: config.memberAliases || {},
    pickHistoryByMember,
    entriesHtml,
    standingsHtml,
  });
}

async function readJson(relPath) {
  const fullPath = path.join(root, relPath);
  const raw = await fs.readFile(fullPath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(relPath, payload) {
  const fullPath = path.join(root, relPath);
  await fs.writeFile(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildLeagueSnapshot(normalized, config) {
  const standings = computeSubgroupStandings(config.subgroupMembers, normalized.events);
  const latestRanks = new Map(
    (normalized.events.at(-1)?.subgroupResults || []).map((r) => [r.member, r.leagueRank ?? null])
  );
  const latestSeason = new Map(
    (normalized.events.at(-1)?.subgroupResults || []).map((r) => [r.member, Number(r.seasonEarnings || 0)])
  );
  const standingsWithLeagueRank = standings.map((row) => ({
    ...row,
    seasonEarnings: latestSeason.get(row.member) ?? row.seasonEarnings,
    leagueRank: latestRanks.get(row.member) ?? null,
  }));

  const weeklyComparison = buildWeeklyComparison(config.subgroupMembers, normalized.events);
  const teams = computeTeamSummary(standingsWithLeagueRank, config.teams || []);

  return {
    event: normalized.events.at(-1) || null,
    nextTournament: normalized.nextTournament || null,
    league: {
      ...normalized.league,
      yourPercentile: computeLeaguePercentile(normalized.league.yourRank, normalized.league.totalEntrants),
    },
    subgroupStandings: standingsWithLeagueRank,
    teams,
    weeklyComparison,
    whoGainedThisWeek: calculateWhoGainedThisWeek(standingsWithLeagueRank),
    projections: normalized.projections,
    sourceNotes: normalized.sourceNotes,
    warnings: normalized.warnings,
    updatedAt: normalized.lastSyncedAt,
  };
}

function buildPlayerPool(normalized, config, currentPool) {
  const allEventRows = normalized.events.flatMap((event) => event.subgroupResults || []);
  const usedByMember = Object.fromEntries(
    config.subgroupMembers.map((member) => [
      member,
      [...new Set(allEventRows.filter((row) => row.member === member).map((row) => row.pick).filter(Boolean))],
    ])
  );

  const projectedGolfers = [...(normalized.projections || [])]
    .map((p) => ({
      name: p.golfer,
      worldRank: Number(p.worldRank || 999),
      fedexPoints: Number(p.fedexPoints || 0),
      seasonEarnings: Number(p.seasonEarnings || 0),
      inNextTournament: Boolean(p.inNextTournament),
    }))
    .sort((a, b) => a.worldRank - b.worldRank || a.name.localeCompare(b.name));
  const usedGolfers = [...new Set(allEventRows.map((row) => row.pick).filter(Boolean))].map((name) => ({
    name,
    worldRank: 999,
    fedexPoints: 0,
    seasonEarnings: 0,
    inNextTournament: false,
  }));
  const golferMap = new Map();
  for (const golfer of [...projectedGolfers, ...usedGolfers]) {
    if (!golferMap.has(golfer.name)) golferMap.set(golfer.name, golfer);
  }
  const golfers = [...golferMap.values()]
    .sort((a, b) => a.worldRank - b.worldRank || a.name.localeCompare(b.name))
    .slice(0, 100);

  const members = Object.fromEntries(
    config.subgroupMembers.map((member) => {
      const used = usedByMember[member] || [];
      return [
        member,
        {
          used,
          available: golfers.map((golfer) => golfer.name).filter((name) => !used.includes(name)),
        },
      ];
    })
  );

  return {
    eventId: normalized.events.at(-1)?.id || null,
    eventTier: normalized.events.at(-1)?.tier || "regular",
    currentEventMeta: {
      totalPurse: normalized.events.at(-1)?.totalPurse || 0,
      firstPrize: normalized.events.at(-1)?.firstPrize || 0,
    },
    members,
    golfers,
    filters: {
      tiers: ["major", "signature", "regular"],
    },
    updatedAt: normalized.lastSyncedAt,
  };
}

async function run() {
  const config = await readConfig(path.join(root, "config/config.json"));
  let currentPool;
  try {
    currentPool = await readJson("data/player_pool.json");
  } catch {
    currentPool = {
      members: Object.fromEntries(
        (config.subgroupMembers || []).map((name) => [name, { used: [], available: [] }])
      ),
      golfers: [],
    };
  }
  const cookie = await loadCookie(path.join(root, config.cookiePath));

  let upstream;
  try {
    if ((config.provider || "splash") === "splash") {
      if (process.env.SPLASH_SOURCE === "chrome") {
        upstream = await fetchSplashFromChrome(config);
      } else {
        upstream = await fetchSplashSportsData({
          baseUrl: config.splash.baseUrl,
          cookie,
          leaguePath: config.splash.leaguePath,
          standingsPath: config.splash.standingsPath,
          subgroupMembers: config.subgroupMembers,
          memberAliases: config.memberAliases || {},
        });
      }
    } else {
      upstream = await fetchRunYourPoolData({
        baseUrl: config.runYourPool.baseUrl,
        cookie,
        leagueId: config.runYourPool.leagueId,
      });
    }
  } catch (error) {
    if (error instanceof SyncError) {
      throw error;
    }
    throw new SyncError(`Unexpected sync failure: ${error.message}`, "UNEXPECTED");
  }

  const normalized = normalizeSnapshot(upstream, config.subgroupMembers);
  let mergedProjections = normalized.projections;
  let sourceNotes = [...(normalized.sourceNotes || [])];

  try {
    const onlineSignals = await readOnlineSignals(path.join(root, "data/online_signals.json"));
    mergedProjections = mergeSignals(normalized.projections, onlineSignals.signals);
    sourceNotes = [...sourceNotes, ...(onlineSignals.sourceNotes || [])];
  } catch {
    sourceNotes.push("Online signal file missing or unreadable; using league-source-only inputs.");
  }

  normalized.projections = mergedProjections;
  normalized.sourceNotes = sourceNotes;

  const snapshot = buildLeagueSnapshot(normalized, config);
  const playerPool = buildPlayerPool(normalized, config, currentPool);

  const andrewAvailable = playerPool.members[config.me]?.available || [];
  const recommendations = {
    event: snapshot.event,
    strategy: "expected-value-plus-form-history-course",
    sourceNotes: snapshot.sourceNotes,
    ...generateRecommendations(andrewAvailable, normalized.projections, {
      weights: config.recommendationWeights,
      eventTier: snapshot.event?.tier,
    }),
    warnings: snapshot.warnings,
  };

  await writeJson("data/league_snapshot.json", snapshot);
  await writeJson("data/player_pool.json", playerPool);
  await writeJson("data/recommendations.json", recommendations);

  const logMessage = `[${new Date().toISOString()}] Sync complete. Event: ${snapshot.event?.name || "N/A"}`;
  await fs.mkdir(path.join(root, "logs"), { recursive: true });
  await fs.appendFile(path.join(root, "logs/sync.log"), `${logMessage}\n`, "utf8");

  console.log(logMessage);
}

run().catch(async (error) => {
  const message = `[${new Date().toISOString()}] Sync failed (${error.code || "ERR"}): ${error.message}`;
  await fs.mkdir(path.join(root, "logs"), { recursive: true });
  await fs.appendFile(path.join(root, "logs/sync.log"), `${message}\n`, "utf8");
  console.error(message);
  process.exitCode = 1;
});
