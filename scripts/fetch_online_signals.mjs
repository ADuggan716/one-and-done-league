#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fetchText } from "../src/lib/online_signals.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);

const PGA_FEDEX_URL = "https://www.pgatour.com/fedexcup/standings.html";
const PGA_MONEY_URL = "https://www.pgatour.com/stats/money-finishes";
const PGA_MONEY_DETAIL_URL = "https://www.pgatour.com/stats/detail/109";
const OWGR_URL = "https://www.owgr.com/current-world-ranking";
const OWGR_FALLBACK_PATH = path.join(root, "data/owgr_fallback.json");

function normalizeName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseMoney(value) {
  const digits = String(value || "").replace(/[$,]/g, "").trim();
  const amount = Number(digits);
  return Number.isFinite(amount) ? amount : 0;
}

function parseNumber(value) {
  const cleaned = String(value || "").replace(/[^\d.-]/g, "");
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function mergeSignalRow(map, golfer, patch, sourceName) {
  const key = normalizeName(golfer);
  if (!key || !/[a-z]/.test(key)) return;
  const existing = map.get(key) || {
    golfer: String(golfer || "").trim(),
    sourceRefs: [],
  };
  map.set(key, {
    ...existing,
    ...patch,
    golfer: existing.golfer || String(golfer || "").trim(),
    sourceRefs: [...new Set([...(existing.sourceRefs || []), sourceName])],
  });
}

function extractNextData(html, label) {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error(`${label}: __NEXT_DATA__ not found`);
  }
  const jsonStart = start + marker.length;
  const end = html.indexOf("</script>", jsonStart);
  if (end === -1) {
    throw new Error(`${label}: __NEXT_DATA__ closing tag not found`);
  }
  return JSON.parse(html.slice(jsonStart, end));
}

function parseFedexSignals(html) {
  const data = extractNextData(html, "FedEx");
  const players = data?.props?.pageProps?.tourCupMetaList?.[0]?.projectedPlayers || [];
  return players.map((player) => ({
    golfer: player.displayName,
    fedexPoints: parseNumber(player.pointData?.official),
  }));
}

function parseMoneySignals(html) {
  const data = extractNextData(html, "Money");
  const queries = data?.props?.pageProps?.dehydratedState?.queries || [];
  const moneyQuery = queries
    .map((query) => query?.state?.data)
    .find((payload) => payload?.statCategory === "MONEY_FINISHES");
  const stats = (moneyQuery?.subCategories || []).flatMap((sub) => sub?.stats || []);
  return stats
    .filter((row) => row?.statTitle === "Official Money")
    .map((row) => ({
      golfer: row.playerName,
      seasonEarnings: parseMoney(row.statValue),
    }));
}

function parseMoneySignalsFromDetailHtml(html) {
  const data = extractNextData(html, "Money detail");
  const queries = data?.props?.pageProps?.dehydratedState?.queries || [];
  const detailQuery = queries
    .map((query) => query?.state?.data)
    .find((payload) => payload?.statId === "109" && Array.isArray(payload?.rows));

  if (!detailQuery) {
    throw new Error("Money detail: stat details rows not found");
  }

  return detailQuery.rows
    .map((row) => {
      const moneyStat = (row?.stats || []).find((stat) => /money/i.test(stat?.statName || ""));
      return {
        golfer: row?.playerName,
        seasonEarnings: parseMoney(moneyStat?.statValue),
      };
    })
    .filter((row) => row.golfer && row.seasonEarnings > 0);
}

function parseMoneySignalsFromTable(rows) {
  const headerIndex = rows.findIndex(
    (row) =>
      row.some((cell) => /player|name/i.test(cell)) &&
      row.some((cell) => /official money|money/i.test(cell))
  );
  if (headerIndex === -1) {
    throw new Error("Money: leaderboard header row not found");
  }

  const header = rows[headerIndex];
  const nameIndex = header.findIndex((cell) => /player|name/i.test(cell));
  const moneyIndex = header.findIndex((cell) => /official money|money/i.test(cell));
  if (nameIndex === -1 || moneyIndex === -1) {
    throw new Error("Money: player/money columns not found");
  }

  return rows
    .slice(headerIndex + 1)
    .map((row) => ({
      golfer: row[nameIndex],
      seasonEarnings: parseMoney(row[moneyIndex]),
    }))
    .filter((row) => row.golfer && /[A-Za-z]/.test(row.golfer));
}

async function readOwgrFallbackSignals() {
  try {
    const raw = await fs.readFile(OWGR_FALLBACK_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.signals) ? parsed.signals : [];
  } catch {
    return [];
  }
}

function mergeMissingWorldRanks(signalMap, fallbackSignals, sourceName) {
  let merged = 0;
  for (const row of fallbackSignals) {
    const key = normalizeName(row?.golfer);
    if (!key) continue;
    const current = signalMap.get(key);
    const currentRank = Number(current?.worldRank);
    if (Number.isFinite(currentRank) && currentRank > 0 && currentRank < 999) continue;
    const nextRank = Number(row?.worldRank);
    if (!Number.isFinite(nextRank) || nextRank <= 0 || nextRank >= 999) continue;
    mergeSignalRow(
      signalMap,
      row.golfer,
      {
        worldRank: nextRank,
        historicalStrength: row.historicalStrength,
      },
      sourceName
    );
    merged += 1;
  }
  return merged;
}

async function captureChromeTableRows(targetUrl) {
  const script = [
    "on run argv",
    "set targetUrl to item 1 of argv",
    'tell application "Google Chrome"',
    'if not running then error "Google Chrome is not running."',
    'activate',
    "set targetTab to missing value",
    "repeat with w in windows",
    "repeat with t in tabs of w",
    "set tabUrl to URL of t as text",
    "if tabUrl starts with targetUrl then",
    "set targetTab to t",
    "exit repeat",
    "end if",
    "end repeat",
    "if targetTab is not missing value then exit repeat",
    "end repeat",
    "if targetTab is missing value then",
    "tell window 1",
    "set targetTab to make new tab with properties {URL:targetUrl}",
    "set active tab index to (count of tabs)",
    "end tell",
    "end if",
    "end tell",
    "delay 5",
    'tell application "Google Chrome"',
    'return execute targetTab javascript "(function(){ function cellText(el){ return (el.innerText || el.textContent || \\\"\\\").trim().replace(/\\\\s+/g, \\\" \\\"); } function collectTableRows(){ return Array.from(document.querySelectorAll(\\\"table tr\\\")).map(function(row){ return Array.from(row.children).filter(function(cell){ return cell.tagName === \\\"TH\\\" || cell.tagName === \\\"TD\\\"; }).map(cellText); }).filter(function(cells){ return cells.some(function(cell){ return cell !== \\\"\\\"; }); }); } function collectRoleRows(){ return Array.from(document.querySelectorAll(\\\"[role=row]\\\")).map(function(row){ return Array.from(row.querySelectorAll(\\\"[role=cell],[role=columnheader]\\\")).map(cellText); }).filter(function(cells){ return cells.some(function(cell){ return cell !== \\\"\\\"; }); }); } var rows = collectTableRows(); if (!rows.length) rows = collectRoleRows(); return JSON.stringify(rows); })()"',
    "end tell",
    "end run",
  ];
  const args = script.flatMap((line) => ["-e", line]).concat(targetUrl);
  const { stdout } = await execFileAsync("osascript", args);
  return JSON.parse(stdout.trim() || "[]");
}

function parseOwgrSignals(rows) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /name/i.test(cell)) && row.some((cell) => /average points/i.test(cell)));
  if (headerIndex === -1) {
    throw new Error("OWGR: ranking header row not found");
  }

  const header = rows[headerIndex];
  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell && cell.trim()))
    .slice(0, 25);

  const inferIndex = (predicate, fallback = -1) => {
    const explicit = header.findIndex(predicate);
    if (explicit !== -1) return explicit;
    return fallback;
  };

  const columnStats = Array.from({ length: Math.max(...dataRows.map((row) => row.length), header.length) }, (_, index) => {
    const samples = dataRows.map((row) => row[index] || "");
    const positiveInts = samples.filter((value) => /^\d+$/.test(value) && Number(value) > 0).length;
    const alpha = samples.filter((value) => /[A-Za-z]/.test(value) && !/^[\d.\-]+$/.test(value)).length;
    const decimals = samples.filter((value) => /^\d+(\.\d+)?$/.test(value)).length;
    return { index, positiveInts, alpha, decimals };
  });

  const rankFallback = [...columnStats].sort((a, b) => b.positiveInts - a.positiveInts)[0]?.index ?? -1;
  const nameFallback = [...columnStats].sort((a, b) => b.alpha - a.alpha)[0]?.index ?? -1;
  const avgFallback = [...columnStats].sort((a, b) => b.decimals - a.decimals)[0]?.index ?? -1;

  const rankIndex = inferIndex((cell) => /this week|current|world ranking|^rank$/i.test(cell), rankFallback);
  const nameIndex = inferIndex((cell) => /^name$|player/i.test(cell), nameFallback);
  const avgPointsIndex = inferIndex((cell) => /average points/i.test(cell), avgFallback);
  if (rankIndex === -1 || nameIndex === -1) {
    throw new Error("OWGR: rank/name columns not found");
  }

  const parsed = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const rank = parseNumber(row[rankIndex]);
    const name = row[nameIndex];
    if (!rank || !name) continue;
    if (rank <= 0 || !Number.isInteger(rank) || rank > 500) continue;
    if (!/[A-Za-z]/.test(name) || /^[\d.\-]+$/.test(name)) continue;
    parsed.push({
      golfer: name,
      worldRank: rank,
      historicalStrength: avgPointsIndex >= 0 ? Math.min(1, parseNumber(row[avgPointsIndex]) / 20) : undefined,
    });
  }
  return parsed;
}

async function main() {
  const output = await refreshOnlineSignals();
  console.log(`Saved ${output.signals.length} online signals.`);
}

export async function refreshOnlineSignals(options = {}) {
  const outputPath = options.outputPath || path.join(root, "data/online_signals.json");
  const signalMap = new Map();
  const sourceNotes = [];

  try {
    const html = await fetchText(PGA_FEDEX_URL, {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
    });
    const rows = parseFedexSignals(html);
    for (const row of rows) mergeSignalRow(signalMap, row.golfer, row, "PGA TOUR FedExCup");
    sourceNotes.push(`PGA TOUR FedExCup: ${rows.length} golfer records loaded`);
  } catch (error) {
    sourceNotes.push(`PGA TOUR FedExCup: failed (${error.message})`);
  }

  try {
    const html = await fetchText(PGA_MONEY_DETAIL_URL, {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
    });
    let rows = parseMoneySignalsFromDetailHtml(html);
    if (rows.length < 50) {
      const overviewHtml = await fetchText(PGA_MONEY_URL, {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
      });
      rows = parseMoneySignals(overviewHtml);
    }
    if (rows.length < 50) {
      const tableRows = await captureChromeTableRows(PGA_MONEY_DETAIL_URL);
      rows = parseMoneySignalsFromTable(tableRows);
    }
    for (const row of rows) mergeSignalRow(signalMap, row.golfer, row, "PGA TOUR Official Money");
    sourceNotes.push(`PGA TOUR Official Money: ${rows.length} golfer records loaded`);
  } catch (error) {
    sourceNotes.push(`PGA TOUR Official Money: failed (${error.message})`);
  }

  try {
    const rows = await captureChromeTableRows(OWGR_URL);
    const parsed = parseOwgrSignals(rows);
    if (parsed.length < 50) {
      throw new Error(`OWGR returned only ${parsed.length} ranking rows`);
    }
    for (const row of parsed) {
      mergeSignalRow(signalMap, row.golfer, row, "OWGR");
    }
    sourceNotes.push(`OWGR: ${parsed.length} golfer records loaded`);
  } catch (error) {
    const fallbackSignals = await readOwgrFallbackSignals();
    const mergedFallbackCount = mergeMissingWorldRanks(signalMap, fallbackSignals, "OWGR fallback");
    if (mergedFallbackCount > 0) {
      sourceNotes.push(`OWGR: failed (${error.message}); fallback restored ${mergedFallbackCount} world ranks`);
    } else {
      sourceNotes.push(`OWGR: failed (${error.message})`);
    }
  }

  const signals = [...signalMap.values()].sort((a, b) => {
    const rankDelta = (a.worldRank ?? 9999) - (b.worldRank ?? 9999);
    return rankDelta || a.golfer.localeCompare(b.golfer);
  });

  const output = {
    fetchedAt: new Date().toISOString(),
    sourceNotes,
    signals,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
