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
const OWGR_URL = "https://www.owgr.com/current-world-ranking";

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
  if (!key) return;
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
  const stats = moneyQuery?.subCategories?.find((sub) => sub?.subCategoryName === "Money")?.stats || [];
  return stats
    .filter((row) => row?.statTitle === "Official Money")
    .map((row) => ({
      golfer: row.playerName,
      seasonEarnings: parseMoney(row.statValue),
    }));
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
    'return execute targetTab javascript "(function(){ function cellText(el){ return (el.innerText || el.textContent || \\\"\\\").trim().replace(/\\\\s+/g, \\\" \\\"); } function collect(selector,rowSelector,cellSelector){ const host=document.querySelector(selector); if(!host) return []; return Array.from(host.querySelectorAll(rowSelector)).map(function(row){ return Array.from(row.querySelectorAll(cellSelector)).map(cellText).filter(Boolean); }).filter(function(cells){ return cells.length >= 4; }); } let rows = collect(\\\"table\\\", \\\"tr\\\", \\\"th,td\\\"); if (!rows.length) { rows = Array.from(document.querySelectorAll(\\\"[role=row]\\\")).map(function(row){ return Array.from(row.querySelectorAll(\\\"[role=cell],[role=columnheader],div,span\\\")).map(cellText).filter(Boolean); }).filter(function(cells){ return cells.length >= 4; }); } return JSON.stringify(rows); })()"',
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
  const rankIndex = header.findIndex((cell) => /ranking/i.test(cell));
  const nameIndex = header.findIndex((cell) => /name/i.test(cell));
  const avgPointsIndex = header.findIndex((cell) => /average points/i.test(cell));
  if (rankIndex === -1 || nameIndex === -1) {
    throw new Error("OWGR: rank/name columns not found");
  }

  const parsed = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const rank = parseNumber(row[rankIndex]);
    const name = row[nameIndex];
    if (!rank || !name) continue;
    parsed.push({
      golfer: name,
      worldRank: rank,
      historicalStrength: avgPointsIndex >= 0 ? Math.min(1, parseNumber(row[avgPointsIndex]) / 20) : undefined,
    });
  }
  return parsed;
}

async function main() {
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
    const html = await fetchText(PGA_MONEY_URL, {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
    });
    const rows = parseMoneySignals(html);
    for (const row of rows) mergeSignalRow(signalMap, row.golfer, row, "PGA TOUR Official Money");
    sourceNotes.push(`PGA TOUR Official Money: ${rows.length} golfer records loaded`);
  } catch (error) {
    sourceNotes.push(`PGA TOUR Official Money: failed (${error.message})`);
  }

  try {
    const rows = await captureChromeTableRows(OWGR_URL);
    const parsed = parseOwgrSignals(rows);
    for (const row of parsed) {
      mergeSignalRow(signalMap, row.golfer, row, "OWGR");
    }
    sourceNotes.push(`OWGR: ${parsed.length} golfer records loaded`);
  } catch (error) {
    sourceNotes.push(`OWGR: failed (${error.message})`);
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

  await fs.writeFile(path.join(root, "data/online_signals.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Saved ${signals.length} online signals.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
