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
  shouldActivateCurrentWeekWindow,
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
import { mergeSignals, readOnlineSignals, synthesizeWeeklySignals } from "../src/lib/online_signals.mjs";
import { buildPlayerPool } from "../src/lib/player_pool.mjs";
import {
  fetchPgaTourSchedule,
  fetchPgaTourTournamentField,
  resolveNextTournamentFromSchedule,
} from "../src/lib/pga_tour_field.mjs";
import { enrichProjectionsWithBettingProfiles } from "../src/lib/pga_tour_betting_profiles.mjs";
import { refreshOnlineSignals } from "./fetch_online_signals.mjs";

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

async function writeJson(relPath, payload) {
  const fullPath = path.join(root, relPath);
  await fs.writeFile(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readJson(relPath) {
  const fullPath = path.join(root, relPath);
  const raw = await fs.readFile(fullPath, "utf8");
  return JSON.parse(raw);
}

function snapshotHasSeasonData(snapshot) {
  return Boolean(
    snapshot?.weeklyComparison?.length &&
      snapshot?.subgroupStandings?.some((row) => Number(row?.seasonEarnings || 0) > 0)
  );
}

function canonicalHistoricalEventName(name) {
  const raw = String(name || "").trim();
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key === "players" || key === "playerschampionship" || key === "theplayers" || key === "theplayerschampionship") {
    return "Players Championship";
  }
  if (key === "houstonopen" || key === "texaschildrenshoustonopen") {
    return "Texas Children's Houston Open";
  }
  return raw;
}

function canonicalHistoricalEventId(name, fallbackId) {
  const canonicalName = canonicalHistoricalEventName(name);
  const fallback = String(fallbackId || "").trim();
  if (fallback && fallback !== "players") return fallback;
  return canonicalName
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function eventHasMeaningfulData(event) {
  const rows = event?.subgroupResults || [];
  return rows.some(
    (row) =>
      row?.pick ||
      Number(row?.earnings || 0) > 0 ||
      (row?.finish !== null && row?.finish !== undefined)
  );
}

function normalizeEventKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function eventIdFromName(name) {
  return canonicalHistoricalEventName(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function restorePendingRows(previousSnapshot, eventName) {
  const normalizedName = normalizeEventKey(eventName);
  const previousEvent = (previousSnapshot?.weeklyComparison || []).find(
    (event) => normalizeEventKey(event.eventName) === normalizedName
  );
  if (!previousEvent) return new Map();

  return new Map(
    (previousEvent.rows || []).map((row) => [
      row.member,
      {
        pick: row.pick ?? null,
        earnings: Number(row.earnings || 0),
        finish: row.finish ?? null,
        leagueRank: row.leagueRank ?? null,
      },
    ])
  );
}

function buildPendingCurrentEvent(nextTournament, subgroupMembers, previousSnapshot) {
  const eventName = canonicalHistoricalEventName(nextTournament?.name);
  const restoredRows = restorePendingRows(previousSnapshot, eventName);
  const subgroupResults = (subgroupMembers || []).map((member) => {
    const restored = restoredRows.get(member) || {};
    return {
      member,
      pick: restored.pick ?? null,
      earnings: Number(restored.earnings || 0),
      seasonEarnings: 0,
      finish: restored.finish ?? null,
      leagueRank: restored.leagueRank ?? null,
    };
  });

  return {
    id: eventIdFromName(eventName),
    name: eventName,
    tier: nextTournament?.tier || "regular",
    startDate: nextTournament?.startDate || null,
    isUpcoming: true,
    countsTowardSeasonTotals: false,
    totalPurse: Number(nextTournament?.totalPurse || 0),
    firstPrize: Number(nextTournament?.firstPrize || 0),
    subgroupResults,
    picks: subgroupResults.map((row) => ({
      member: row.member,
      golfer: row.pick,
      earnings: row.earnings,
      seasonEarnings: 0,
      finish: row.finish,
      leagueRank: row.leagueRank,
    })),
  };
}

function snapshotHistoryMetrics(snapshot) {
  const events = snapshot?.weeklyComparison || [];
  const seasonEarningsTotal = (snapshot?.subgroupStandings || []).reduce(
    (sum, row) => sum + Number(row?.seasonEarnings || 0),
    0
  );

  return {
    eventCount: events.length,
    completedEventCount: events.filter((event) => event?.countsTowardSeasonTotals !== false).length,
    seasonEarningsTotal,
    updatedAtMs: Number.isFinite(Date.parse(snapshot?.updatedAt || "")) ? Date.parse(snapshot.updatedAt) : 0,
  };
}

function compareSnapshotRichness(left, right) {
  const a = snapshotHistoryMetrics(left);
  const b = snapshotHistoryMetrics(right);

  if (a.completedEventCount !== b.completedEventCount) {
    return a.completedEventCount - b.completedEventCount;
  }
  if (a.eventCount !== b.eventCount) {
    return a.eventCount - b.eventCount;
  }
  if (a.seasonEarningsTotal !== b.seasonEarningsTotal) {
    return a.seasonEarningsTotal - b.seasonEarningsTotal;
  }
  return a.updatedAtMs - b.updatedAtMs;
}

function normalizedHasSeasonHistory(normalized) {
  const events = normalized?.events || [];
  if (events.length === 0) return false;
  const completedEvents = events.filter((event) => event?.isUpcoming !== true);

  // Only completed events count as historical season state. Upcoming/current event
  // rows can carry YTD totals from Splash without implying full history exists.
  if (
    completedEvents.some((event) =>
      (event?.subgroupResults || []).some((row) => Number(row?.seasonEarnings || 0) > 0)
    )
  ) {
    return true;
  }

  return completedEvents.length > 1;
}

async function loadLastGoodSnapshot() {
  const candidates = [];
  let bestSnapshot = null;

  try {
    const current = await readJson("data/league_snapshot.json");
    if (snapshotHasSeasonData(current)) {
      candidates.push(current);
      bestSnapshot = current;
    }
  } catch {
    // Fall through to git history lookup.
  }

  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "log", "--format=%H", "--", "data/league_snapshot.json"]);
    const commits = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20);

    for (const commit of commits) {
      try {
        const { stdout: snapshotRaw } = await execFileAsync("git", [
          "-C",
          root,
          "show",
          `${commit}:data/league_snapshot.json`,
        ]);
        const snapshot = JSON.parse(snapshotRaw);
        if (snapshotHasSeasonData(snapshot)) {
          candidates.push(snapshot);
          if (!bestSnapshot || compareSnapshotRichness(snapshot, bestSnapshot) > 0) {
            bestSnapshot = snapshot;
          }
        }
      } catch {
        // Try the next historical snapshot.
      }
    }
  } catch {
    // No historical fallback available.
  }

  return mergeHistoricalSnapshots(candidates) || bestSnapshot;
}

async function loadHistoricalSnapshotCandidates() {
  const candidates = [];

  try {
    const current = await readJson("data/league_snapshot.json");
    if (snapshotHasSeasonData(current)) {
      candidates.push(current);
    }
  } catch {
    // Fall through to git history lookup.
  }

  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "log", "--format=%H", "--", "data/league_snapshot.json"]);
    const commits = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20);

    for (const commit of commits) {
      try {
        const { stdout: snapshotRaw } = await execFileAsync("git", [
          "-C",
          root,
          "show",
          `${commit}:data/league_snapshot.json`,
        ]);
        const snapshot = JSON.parse(snapshotRaw);
        if (snapshotHasSeasonData(snapshot)) {
          candidates.push(snapshot);
        }
      } catch {
        // Try the next historical snapshot.
      }
    }
  } catch {
    // No historical fallback available.
  }

  return candidates;
}

function extractExplicitSeasonTotals(normalized, members) {
  const explicitTotals = new Map();

  for (const event of normalized?.events || []) {
    for (const row of event?.subgroupResults || []) {
      const value = Number(row?.seasonEarnings || 0);
      if (members.includes(row.member) && value > 0) {
        explicitTotals.set(row.member, value);
      }
    }
  }

  const mappingNote = (normalized?.sourceNotes || []).find((note) => String(note).startsWith("Splash mapping:"));
  if (mappingNote) {
    const payload = String(mappingNote).replace(/^Splash mapping:\s*/, "");
    for (const segment of payload.split("|")) {
      const trimmed = segment.trim();
      const match = trimmed.match(/^([^:]+):.*season=(\d+)/i);
      if (!match) continue;
      const member = match[1].trim();
      const seasonEarnings = Number(match[2]);
      if (members.includes(member) && seasonEarnings > 0) {
        explicitTotals.set(member, seasonEarnings);
      }
    }
  }

  return explicitTotals;
}

function scoreSnapshotAgainstSeasonTotals(snapshot, explicitTotals, members) {
  let compared = 0;
  let totalDelta = 0;
  const standingsByMember = new Map((snapshot?.subgroupStandings || []).map((row) => [row.member, Number(row?.seasonEarnings || 0)]));

  for (const member of members) {
    const explicit = explicitTotals.get(member);
    if (!Number.isFinite(explicit) || explicit <= 0) continue;
    compared += 1;
    totalDelta += Math.abs((standingsByMember.get(member) || 0) - explicit);
  }

  return {
    compared,
    totalDelta,
  };
}

function selectBestHistoricalSnapshot(candidates, explicitTotals, members) {
  if (!candidates.length) return null;

  const historyRichCandidates = candidates.filter(
    (snapshot) => (snapshot?.weeklyComparison || []).filter((event) => event?.countsTowardSeasonTotals !== false).length > 1
  );
  const pool = historyRichCandidates.length ? historyRichCandidates : candidates;

  let best = null;
  let bestScore = null;
  for (const snapshot of pool) {
    const score = scoreSnapshotAgainstSeasonTotals(snapshot, explicitTotals, members);
    if (score.compared === 0) continue;
    if (
      !bestScore ||
      score.totalDelta < bestScore.totalDelta ||
      (score.totalDelta === bestScore.totalDelta && compareSnapshotRichness(snapshot, best) > 0)
    ) {
      best = snapshot;
      bestScore = score;
    }
  }

  return best || mergeHistoricalSnapshots(pool) || pool[0];
}

function restoreEventsFromSnapshot(snapshot) {
  return (snapshot?.weeklyComparison || [])
    .map((event) => ({
      id: canonicalHistoricalEventId(event.eventName, event.eventId),
      name: canonicalHistoricalEventName(event.eventName),
      tier: event.tier || "regular",
      startDate: event.startDate || null,
      isUpcoming: false,
      countsTowardSeasonTotals: event.countsTowardSeasonTotals !== false,
      totalPurse: Number(event.totalPurse || 0),
      firstPrize: Number(event.firstPrize || 0),
      subgroupResults: (event.rows || []).map((row) => ({
        member: row.member,
        pick: row.pick ?? null,
        earnings: Number(row.earnings || 0),
        seasonEarnings: Number(row.seasonEarnings || 0),
        finish: row.finish ?? null,
        leagueRank: row.leagueRank ?? null,
      })),
      picks: (event.rows || []).map((row) => ({
        member: row.member,
        golfer: row.pick ?? null,
        earnings: Number(row.earnings || 0),
        seasonEarnings: Number(row.seasonEarnings || 0),
        finish: row.finish ?? null,
        leagueRank: row.leagueRank ?? null,
      })),
    }))
    .filter(eventHasMeaningfulData);
}

function eventRichnessMetrics(event) {
  const rows = event?.subgroupResults || [];
  return {
    nonEmptyPickCount: rows.filter((row) => row?.pick).length,
    completedFinishCount: rows.filter((row) => row?.finish !== null && row?.finish !== undefined).length,
    totalEarnings: rows.reduce((sum, row) => sum + Number(row?.earnings || 0), 0),
  };
}

function compareEventRichness(left, right) {
  const a = eventRichnessMetrics(left);
  const b = eventRichnessMetrics(right);

  if (a.totalEarnings !== b.totalEarnings) return a.totalEarnings - b.totalEarnings;
  if (a.completedFinishCount !== b.completedFinishCount) return a.completedFinishCount - b.completedFinishCount;
  return a.nonEmptyPickCount - b.nonEmptyPickCount;
}

function toWeeklyComparisonEvent(event) {
  return {
    eventId: event.id,
    eventName: event.name,
    tier: event.tier || "regular",
    startDate: event.startDate || null,
    countsTowardSeasonTotals: event.countsTowardSeasonTotals !== false,
    totalPurse: Number(event.totalPurse || 0),
    firstPrize: Number(event.firstPrize || 0),
    rows: (event.subgroupResults || []).map((row) => ({
      member: row.member,
      eventId: event.id,
      eventName: event.name,
      tier: event.tier || "regular",
      totalPurse: Number(event.totalPurse || 0),
      firstPrize: Number(event.firstPrize || 0),
      earnings: Number(row.earnings || 0),
      finish: row.finish ?? null,
      pick: row.pick ?? null,
      leagueRank: row.leagueRank ?? null,
    })),
  };
}

function toLeagueWidePickEvent(event) {
  return {
    eventId: event.eventId || event.id,
    eventName: event.eventName || event.name,
    tier: event.tier || "regular",
    startDate: event.startDate || null,
    countsTowardSeasonTotals: event.countsTowardSeasonTotals !== false,
    totalPurse: Number(event.totalPurse || 0),
    firstPrize: Number(event.firstPrize || 0),
    totalEntrants: Number(event.totalEntrants || 0),
    rows: (event.rows || []).map((row) => ({
      golfer: row.golfer || null,
      pickCount: Number(row.pickCount || 0),
      finish: row.finish ?? null,
      earnings: Number(row.earnings || 0),
    })),
  };
}

function compareLeagueWideEventRichness(left, right) {
  const leftRows = left?.rows || [];
  const rightRows = right?.rows || [];
  const leftPicks = leftRows.reduce((sum, row) => sum + Number(row?.pickCount || 0), 0);
  const rightPicks = rightRows.reduce((sum, row) => sum + Number(row?.pickCount || 0), 0);

  if (leftPicks !== rightPicks) return leftPicks - rightPicks;
  if (leftRows.length !== rightRows.length) return leftRows.length - rightRows.length;
  return Number(left?.totalEntrants || 0) - Number(right?.totalEntrants || 0);
}

function mergeLeagueWidePickHistory(...collections) {
  const merged = new Map();
  for (const collection of collections) {
    for (const event of collection || []) {
      if (!event?.eventId && !event?.eventName) continue;
      const eventId = event.eventId || event.id || eventIdFromName(event.eventName || event.name);
      const normalizedEvent = toLeagueWidePickEvent({ ...event, eventId });
      const current = merged.get(eventId);
      if (!current || compareLeagueWideEventRichness(normalizedEvent, current) > 0) {
        merged.set(eventId, normalizedEvent);
      }
    }
  }
  return [...merged.values()];
}

function mergeHistoricalSnapshots(snapshots) {
  const candidates = (snapshots || []).filter(Boolean);
  if (candidates.length === 0) return null;

  const richestSnapshot = candidates.reduce((best, snapshot) => {
    if (!best) return snapshot;
    return compareSnapshotRichness(snapshot, best) > 0 ? snapshot : best;
  }, null);

  const mergedEvents = new Map();
  for (const snapshot of [richestSnapshot, ...candidates.filter((snapshot) => snapshot !== richestSnapshot)]) {
    for (const event of restoreEventsFromSnapshot(snapshot)) {
      const current = mergedEvents.get(event.id);
      if (!current || compareEventRichness(event, current) > 0) {
        mergedEvents.set(event.id, event);
      }
    }
  }

  return {
    ...richestSnapshot,
    weeklyComparison: [...mergedEvents.values()].map(toWeeklyComparisonEvent),
    leagueWidePickHistory: mergeLeagueWidePickHistory(
      ...candidates.map((snapshot) => snapshot?.leagueWidePickHistory || [])
    ),
  };
}

function dedupeEventsById(events) {
  const byId = new Map();
  for (const event of events || []) {
    if (!event?.id && !event?.eventId) continue;
    byId.set(event.id || event.eventId, event);
  }
  return [...byId.values()];
}

function latestCompletedEvent(events) {
  const completed = (events || []).filter((event) => event?.countsTowardSeasonTotals !== false);
  return completed.at(-1) || null;
}

function buildLeagueSnapshot(normalized, config) {
  const dedupedEvents = dedupeEventsById(normalized.events);
  const standings = computeSubgroupStandings(config.subgroupMembers, dedupedEvents);
  const liveEvent = [...dedupedEvents].reverse().find((event) => event?.countsTowardSeasonTotals === false) || null;
  const displayEvent = liveEvent || latestCompletedEvent(dedupedEvents) || dedupedEvents.at(-1) || null;
  const latestRanks = new Map((displayEvent?.subgroupResults || []).map((r) => [r.member, r.leagueRank ?? null]));
  const standingsWithLeagueRank = standings.map((row) => ({
    ...row,
    leagueRank: latestRanks.get(row.member) ?? null,
  }));

  const weeklyComparison = dedupeEventsById(buildWeeklyComparison(config.subgroupMembers, dedupedEvents));
  const leagueWidePickHistory = mergeLeagueWidePickHistory(normalized.leagueWideHistory || []);
  const teams = computeTeamSummary(standingsWithLeagueRank, config.teams || []);

  return {
    event: displayEvent,
    nextTournament: normalized.nextTournament || null,
    league: {
      ...normalized.league,
      yourPercentile: computeLeaguePercentile(normalized.league.yourRank, normalized.league.totalEntrants),
    },
    subgroupStandings: standingsWithLeagueRank,
    teams,
    weeklyComparison,
    leagueWidePickHistory,
    whoGainedThisWeek: calculateWhoGainedThisWeek(standingsWithLeagueRank),
    projections: normalized.projections,
    sourceNotes: normalized.sourceNotes,
    warnings: normalized.warnings,
    updatedAt: normalized.lastSyncedAt,
  };
}

function parsedHistoryRowCountFromNotes(sourceNotes) {
  const note = (sourceNotes || []).find((item) => String(item).startsWith("Splash parsed history rows:"));
  const match = String(note || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function applyExplicitSeasonTotalsToSnapshot(snapshot, explicitSeasonTotals, config) {
  if (!snapshot?.subgroupStandings?.length || !explicitSeasonTotals?.size) return snapshot;

  const updatedStandings = snapshot.subgroupStandings.map((row) => ({
    ...row,
    seasonEarnings: explicitSeasonTotals.get(row.member) ?? row.seasonEarnings,
  }));

  updatedStandings.sort((a, b) => b.seasonEarnings - a.seasonEarnings || a.member.localeCompare(b.member));

  let currentRank = 1;
  let previousEarnings = null;
  for (let i = 0; i < updatedStandings.length; i += 1) {
    if (previousEarnings !== null && updatedStandings[i].seasonEarnings < previousEarnings) {
      currentRank = i + 1;
    }
    updatedStandings[i].groupRank = currentRank;
    previousEarnings = updatedStandings[i].seasonEarnings;
  }

  const leader = updatedStandings[0]?.seasonEarnings ?? 0;
  const rankedStandings = updatedStandings.map((row) => ({
    ...row,
    toLeader: leader - row.seasonEarnings,
  }));

  return {
    ...snapshot,
    subgroupStandings: rankedStandings,
    teams: computeTeamSummary(rankedStandings, config.teams || []),
    whoGainedThisWeek: calculateWhoGainedThisWeek(rankedStandings),
    sourceNotes: [
      ...(snapshot.sourceNotes || []),
      "Standings season totals reconciled to explicit Splash year-to-date values.",
    ],
  };
}

function applyCompletedEventRollover(snapshot, previousSnapshot, normalizedNextTournament, config) {
  if (!snapshot?.subgroupStandings?.length || !snapshot?.weeklyComparison?.length) return snapshot;

  const completedEvent = latestCompletedEvent(snapshot.weeklyComparison);
  const nextTournamentName = canonicalHistoricalEventName(normalizedNextTournament?.name);
  if (!completedEvent?.eventName || !nextTournamentName) return snapshot;

  const completedKey = normalizeEventKey(completedEvent.eventName);
  const nextKey = normalizeEventKey(nextTournamentName);
  if (!completedKey || completedKey === nextKey) return snapshot;

  const previousHadNextWeekOpen = (previousSnapshot?.weeklyComparison || []).some(
    (event) => normalizeEventKey(event?.eventName) === nextKey
  );
  const previousStandings = new Map((previousSnapshot?.subgroupStandings || []).map((row) => [row.member, row]));
  const previousWasPreRollover = !previousHadNextWeekOpen;

  const updatedStandings = snapshot.subgroupStandings.map((row) => {
    const eventRow = (completedEvent.rows || []).find((item) => item.member === row.member) || {};
    const weeklyEarnings = Number(eventRow.earnings || row.weeklyEarnings || 0);
    const previousSeason = Number(previousStandings.get(row.member)?.seasonEarnings || 0);
    const currentSeason = Number(row.seasonEarnings || 0);

    let seasonEarnings = currentSeason;
    if (previousWasPreRollover) {
      seasonEarnings = Math.max(currentSeason, previousSeason + weeklyEarnings);
    } else if (previousSeason > currentSeason) {
      seasonEarnings = previousSeason;
    }

    return {
      ...row,
      seasonEarnings,
      weeklyEarnings,
    };
  });

  updatedStandings.sort((a, b) => b.seasonEarnings - a.seasonEarnings || a.member.localeCompare(b.member));

  let currentRank = 1;
  let previousEarnings = null;
  for (let i = 0; i < updatedStandings.length; i += 1) {
    if (previousEarnings !== null && updatedStandings[i].seasonEarnings < previousEarnings) {
      currentRank = i + 1;
    }
    updatedStandings[i].groupRank = currentRank;
    previousEarnings = updatedStandings[i].seasonEarnings;
  }

  const leader = updatedStandings[0]?.seasonEarnings ?? 0;
  const rankedStandings = updatedStandings.map((row) => ({
    ...row,
    toLeader: leader - row.seasonEarnings,
  }));

  return {
    ...snapshot,
    subgroupStandings: rankedStandings,
    teams: computeTeamSummary(rankedStandings, config.teams || []),
    whoGainedThisWeek: calculateWhoGainedThisWeek(rankedStandings),
    sourceNotes: [
      ...(snapshot.sourceNotes || []),
      `Completed-event rollover applied for ${completedEvent.eventName}.`,
    ],
  };
}

function applyHistoryBackfillFloor(snapshot, config) {
  if (!snapshot?.subgroupStandings?.length) return snapshot;

  const updatedStandings = snapshot.subgroupStandings.map((row) => {
    const computedFromHistory = (row.history || []).reduce((sum, week) => sum + Number(week?.earnings || 0), 0);
    return {
      ...row,
      seasonEarnings: Math.max(Number(row.seasonEarnings || 0), computedFromHistory),
    };
  });

  updatedStandings.sort((a, b) => b.seasonEarnings - a.seasonEarnings || a.member.localeCompare(b.member));

  let currentRank = 1;
  let previousEarnings = null;
  for (let i = 0; i < updatedStandings.length; i += 1) {
    if (previousEarnings !== null && updatedStandings[i].seasonEarnings < previousEarnings) {
      currentRank = i + 1;
    }
    updatedStandings[i].groupRank = currentRank;
    previousEarnings = updatedStandings[i].seasonEarnings;
  }

  const leader = updatedStandings[0]?.seasonEarnings ?? 0;
  const rankedStandings = updatedStandings.map((row) => ({
    ...row,
    toLeader: leader - row.seasonEarnings,
  }));

  return {
    ...snapshot,
    subgroupStandings: rankedStandings,
    teams: computeTeamSummary(rankedStandings, config.teams || []),
    whoGainedThisWeek: calculateWhoGainedThisWeek(rankedStandings),
    sourceNotes: [
      ...(snapshot.sourceNotes || []),
      "Season totals floored to reconstructed completed-event history when that history exceeds Splash year-to-date values.",
    ],
  };
}

async function run() {
  const config = await readConfig(path.join(root, "config/config.json"));
  const historicalSnapshots = await loadHistoricalSnapshotCandidates();
  const previousSnapshot = await loadLastGoodSnapshot();
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
          entryIds: config.entryIds || {},
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
  let onlineSignals = null;

  try {
    onlineSignals = await refreshOnlineSignals({
      outputPath: path.join(root, "data/online_signals.json"),
    });
    sourceNotes = [
      ...sourceNotes,
      `Online signals refreshed at ${onlineSignals.fetchedAt}.`,
      ...(onlineSignals.sourceNotes || []),
    ];
  } catch {
    sourceNotes.push("Online signal refresh failed; using cached online signals if available.");
  }

  try {
    if (!onlineSignals) {
      onlineSignals = await readOnlineSignals(path.join(root, "data/online_signals.json"));
      sourceNotes = [...sourceNotes, ...(onlineSignals.sourceNotes || [])];
    }
    mergedProjections = mergeSignals(normalized.projections, onlineSignals.signals);
  } catch {
    sourceNotes.push("Online signal file missing or unreadable; using league-source-only inputs.");
  }

  normalized.projections = mergedProjections;
  normalized.sourceNotes = sourceNotes;

  const explicitSeasonTotals = extractExplicitSeasonTotals(normalized, config.subgroupMembers);
  const matchedHistoricalSnapshot =
    explicitSeasonTotals.size > 0
      ? selectBestHistoricalSnapshot(historicalSnapshots, explicitSeasonTotals, config.subgroupMembers)
      : previousSnapshot;
  const parsedHistoryRowCount = parsedHistoryRowCountFromNotes(normalized.sourceNotes);

  if (matchedHistoricalSnapshot?.weeklyComparison?.length) {
    if (!normalized.events || normalized.events.length === 0) {
      normalized.events = restoreEventsFromSnapshot(matchedHistoricalSnapshot);
      normalized.league = {
        ...normalized.league,
        ...(matchedHistoricalSnapshot.league || {}),
      };
      normalized.sourceNotes = [
        ...normalized.sourceNotes,
        "Fallback: reused previous committed season history because upstream returned no event history.",
      ];
    } else if (!normalizedHasSeasonHistory(normalized) || parsedHistoryRowCount === 0) {
      const restored = restoreEventsFromSnapshot(matchedHistoricalSnapshot);
      const currentIds = new Set((normalized.events || []).map((event) => event.id));
      normalized.events = [
        ...restored.filter((event) => !currentIds.has(event.id)),
        ...normalized.events,
      ];
      normalized.sourceNotes = [
        ...normalized.sourceNotes,
        parsedHistoryRowCount === 0
          ? "Fallback: reused previous committed season history because Splash returned no historical event rows."
          : "Fallback: reused previous committed season history because upstream only returned current-week data.",
      ];
    }
  }

  try {
    const upstreamEventName = normalized.nextTournament?.name || normalized.events.at(-1)?.name;
    const tournaments = await fetchPgaTourSchedule();
    normalized.nextTournament = resolveNextTournamentFromSchedule(
      tournaments,
      upstreamEventName,
      {
        currentEventCompleted: normalized.events.at(-1)?.countsTowardSeasonTotals !== false,
      }
    );
    normalized.sourceNotes = [
      ...normalized.sourceNotes,
      `PGA TOUR schedule resolved next tournament: ${normalized.nextTournament.name}`,
    ];
  } catch (error) {
    normalized.sourceNotes = [
      ...normalized.sourceNotes,
      `PGA TOUR schedule: failed (${error.message})`,
    ];
  }

  let nextTournamentField = [];
  try {
    const field = await fetchPgaTourTournamentField(normalized.nextTournament?.name || normalized.events.at(-1)?.name);
    nextTournamentField = field.playerNames;
    normalized.sourceNotes = [
      ...normalized.sourceNotes,
      `PGA TOUR field source: ${field.fieldUrl}`,
      `PGA TOUR field entries: ${field.playerNames.length}`,
    ];
  } catch (error) {
    normalized.sourceNotes = [
      ...normalized.sourceNotes,
      `PGA TOUR field: failed (${error.message})`,
    ];
  }

  const latestEvent = normalized.events?.at(-1);
  if (
    latestEvent &&
    eventHasMeaningfulData(latestEvent) &&
    normalizeEventKey(latestEvent.name) !== normalizeEventKey(normalized.nextTournament?.name)
  ) {
    latestEvent.countsTowardSeasonTotals = true;
  }

  const syncedAt = new Date(normalized.lastSyncedAt || Date.now());
  const activeEventName = canonicalHistoricalEventName(normalized.nextTournament?.name);
  const hasActiveWeekEvent = (normalized.events || []).some(
    (event) => normalizeEventKey(event.name) === normalizeEventKey(activeEventName)
  );
  const mostRecentCompletedEvent = latestCompletedEvent(normalized.events);
  const completedWeekRolledOver =
    mostRecentCompletedEvent &&
    normalizeEventKey(mostRecentCompletedEvent.name) !== normalizeEventKey(activeEventName);
  if (
    normalized.nextTournament &&
    (shouldActivateCurrentWeekWindow(normalized.nextTournament, syncedAt) || completedWeekRolledOver) &&
    !hasActiveWeekEvent
  ) {
    normalized.events = [
      ...(normalized.events || []),
      buildPendingCurrentEvent(normalized.nextTournament, config.subgroupMembers, matchedHistoricalSnapshot),
    ];
    normalized.sourceNotes = [
      ...normalized.sourceNotes,
      completedWeekRolledOver
        ? `Opened next-tournament view for ${activeEventName} after finalizing ${mostRecentCompletedEvent.name}.`
        : `Activated current-week view for ${activeEventName} at Thursday 8:00 AM ET.`,
    ];
  }

  const synthesized = synthesizeWeeklySignals(normalized.projections, {
    nextTournamentField,
    nextTournament: normalized.nextTournament,
    events: normalized.events,
    subgroupMembers: config.subgroupMembers,
    me: config.me,
  });
  normalized.projections = synthesized.projections;
  if (synthesized.synthesisSummary.fieldCandidateCount > 0) {
    normalized.sourceNotes = [
      ...normalized.sourceNotes,
      `Weekly projection synthesis: ${synthesized.synthesisSummary.synthesizedCount} field golfers received modeled payout estimates`,
      `Weekly projection synthesis top field: ${(synthesized.synthesisSummary.topCandidates || []).join(", ")}`,
    ];
  } else {
    normalized.sourceNotes = [
      ...normalized.sourceNotes,
      `Weekly projection synthesis: skipped (${synthesized.synthesisSummary.reason || "no eligible field golfers"})`,
    ];
  }

  const hasLivePickHistory = Number(parsedHistoryRowCount || 0) > 0;
  let snapshot = buildLeagueSnapshot(normalized, config);
  snapshot = {
    ...snapshot,
    leagueWidePickHistory: mergeLeagueWidePickHistory(
      matchedHistoricalSnapshot?.leagueWidePickHistory || [],
      previousSnapshot?.leagueWidePickHistory || [],
      snapshot.leagueWidePickHistory || []
    ),
  };
  if (!hasLivePickHistory && explicitSeasonTotals.size > 0) {
    snapshot = applyExplicitSeasonTotalsToSnapshot(snapshot, explicitSeasonTotals, config);
  }
  if (!hasLivePickHistory) {
    snapshot = applyCompletedEventRollover(snapshot, previousSnapshot, normalized.nextTournament, config);
    snapshot = applyHistoryBackfillFloor(snapshot, config);
  } else {
    snapshot = {
      ...snapshot,
      sourceNotes: [
        ...(snapshot.sourceNotes || []),
        "Live Splash pick-history rows available; season totals derived directly from reconstructed event history.",
      ],
    };
  }
  const playerPool = buildPlayerPool(normalized, config, { nextTournamentField });
  try {
    const enrichedProfiles = await enrichProjectionsWithBettingProfiles(normalized.projections, {
      nextTournament: normalized.nextTournament,
      golfers: playerPool.members[config.me]?.available || [],
    });
    normalized.projections = enrichedProfiles.projections;
    normalized.sourceNotes = [...normalized.sourceNotes, ...(enrichedProfiles.sourceNotes || [])];
  } catch (error) {
    normalized.sourceNotes = [
      ...normalized.sourceNotes,
      `PGA TOUR betting profiles: failed (${error.message})`,
    ];
  }
  snapshot = {
    ...snapshot,
    projections: normalized.projections,
    sourceNotes: normalized.sourceNotes,
  };

  const andrewAvailable = playerPool.members[config.me]?.available || [];
  const recommendations = {
    currentEvent: snapshot.event,
    event: snapshot.nextTournament || snapshot.event,
    strategy: "balanced-weekly-pick-with-tradeoffs",
    sourceNotes: normalized.sourceNotes,
    ...generateRecommendations(andrewAvailable, normalized.projections, {
      weights: config.recommendationWeights,
      eventTier: snapshot.nextTournament?.tier || snapshot.event?.tier,
      nextTournamentField: playerPool.nextTournamentField || [],
      playerPoolGolfers: playerPool.golfers || [],
      sourceNotes: snapshot.sourceNotes || [],
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
