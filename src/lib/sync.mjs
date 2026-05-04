import fs from "node:fs/promises";

export class SyncError extends Error {
  constructor(message, code = "SYNC_ERROR") {
    super(message);
    this.code = code;
  }
}

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function formatFetchError(error) {
  const bits = [error?.message || "fetch failed"];
  if (error?.cause?.code) bits.push(`code=${error.cause.code}`);
  if (error?.cause?.errno) bits.push(`errno=${error.cause.errno}`);
  if (error?.cause?.syscall) bits.push(`syscall=${error.cause.syscall}`);
  if (error?.cause?.hostname) bits.push(`host=${error.cause.hostname}`);
  return bits.join(" | ");
}

function parseCookieJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function dedupeCookiePairs(pairs) {
  const out = new Map();
  for (const pair of pairs) {
    const name = String(pair?.name || "").trim();
    const value = String(pair?.value || "").trim();
    if (!name || !COOKIE_NAME_PATTERN.test(name) || !value) continue;
    out.set(name, value);
  }
  return [...out.entries()].map(([name, value]) => `${name}=${value}`);
}

export function normalizeCookieInput(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    throw new SyncError("Cookie file is empty.", "COOKIE_EMPTY");
  }

  if (/replace-with-your-runyourpool-session-cookie/i.test(text)) {
    throw new SyncError("Cookie file still contains the placeholder value.", "COOKIE_PLACEHOLDER");
  }

  const json = parseCookieJson(text);
  if (Array.isArray(json)) {
    const cookiePairs = dedupeCookiePairs(json);
    if (cookiePairs.length > 0) return cookiePairs.join("; ");
  }

  const netscapeLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (netscapeLines.length > 0 && netscapeLines.every((line) => line.split("\t").length >= 7)) {
    const cookiePairs = dedupeCookiePairs(
      netscapeLines.map((line) => {
        const parts = line.split("\t");
        return { name: parts[5], value: parts[6] };
      })
    );
    if (cookiePairs.length > 0) return cookiePairs.join("; ");
  }

  const headerCookieLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^cookie:/i.test(line))
    .map((line) => line.replace(/^cookie:\s*/i, "").trim())
    .filter(Boolean);
  if (headerCookieLines.length > 0) {
    return headerCookieLines.join("; ");
  }

  if (/^[A-Za-z-]+:\s*/m.test(text) && !/^cookie:/im.test(text)) {
    throw new SyncError("Copied request headers did not include a Cookie header.", "COOKIE_MISSING_HEADER");
  }

  const inlinePairs = text
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (inlinePairs.length > 0 && inlinePairs.every((pair) => pair.includes("="))) {
    const cookiePairs = dedupeCookiePairs(
      inlinePairs.map((pair) => {
        const idx = pair.indexOf("=");
        return { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
      })
    );
    if (cookiePairs.length > 0) return cookiePairs.join("; ");
  }

  throw new SyncError("Cookie file format is not recognized. Use a Cookie header, cookie-jar export, or name=value pairs.", "COOKIE_BAD_FORMAT");
}

async function fetchOrThrow(url, options, label) {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new SyncError(`${label} fetch failed for ${url} (${formatFetchError(error)})`, "NETWORK_ERROR");
  }
}

async function writeDebugHtml(name, html) {
  try {
    await fs.mkdir("logs", { recursive: true });
    await fs.writeFile(`logs/${name}.html`, String(html || ""), "utf8");
  } catch {
    // Debug capture should never block the sync flow.
  }
}

export async function readConfig(path) {
  const raw = await fs.readFile(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new SyncError("Config JSON is malformed.", "BAD_CONFIG_JSON");
  }
}

function safeText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toMoney(text) {
  if (!text) return 0;
  const stripped = String(text).replace(/[^0-9.-]/g, "");
  const n = Number(stripped);
  return Number.isFinite(n) ? n : 0;
}

function matchCurrency(text) {
  const m = String(text || "").match(/\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  return m ? toMoney(m[1]) : 0;
}

function matchMoneyLoose(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  // Supports values like "$1,250,000" or "1,250,000"
  const withDollar = matchCurrency(t);
  if (withDollar > 0) return withDollar;
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t)) return toMoney(t);
  return 0;
}

function canonicalizeEventName(value) {
  const raw = String(value || "").trim();
  const key = normalizeCompact(raw);

  if (key === "players" || key === "playerschampionship" || key === "theplayers" || key === "theplayerschampionship") {
    return "Players Championship";
  }
  if (key === "houston" || key === "houstonopen" || key === "texaschildrenshoustonopen") {
    return "Texas Children's Houston Open";
  }
  if (key === "valero" || key === "valerotexasopen") {
    return "Valero Texas Open";
  }
  if (key === "valspar" || key === "valsparchampionship") {
    return "Valspar Championship";
  }
  if (key === "arnoldpalmer" || key === "arnoldpalmerinvitational") {
    return "Arnold Palmer";
  }
  if (key === "themasters" || key === "masterstournament" || key === "masters") {
    return "Masters Tournament";
  }
  if (key === "miami" || key === "miamichampionship" || key === "cadillacchampionship") {
    return "Miami Championship";
  }

  return raw;
}

function normalizeEventId(value) {
  return canonicalizeEventName(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCompact(value) {
  return normalizeKey(value).replace(/[^a-z0-9]/g, "");
}

function resolveMemberFromEntry(entryName, subgroupMembers, memberAliases = {}) {
  const aliasEntries = Object.entries(memberAliases || {});
  const hasAliases = aliasEntries.length > 0;
  const byAlias = new Map();
  const normalizedAliases = aliasEntries.map(([alias, member]) => ({
    alias,
    member: String(member),
    aliasKey: normalizeKey(alias),
    aliasCompact: normalizeCompact(alias),
  }));

  for (const [alias, member] of aliasEntries) {
    byAlias.set(normalizeKey(alias), String(member));
    byAlias.set(normalizeCompact(alias), String(member));
  }

  // Also allow explicit member names as exact IDs.
  for (const member of subgroupMembers || []) {
    byAlias.set(normalizeKey(member), member);
    byAlias.set(normalizeCompact(member), member);
  }

  const direct = byAlias.get(normalizeKey(entryName)) || byAlias.get(normalizeCompact(entryName));
  if (direct) return direct;

  // Splash sometimes appends labels to entry names; allow alias containment for configured aliases.
  const entryKey = normalizeKey(entryName);
  const entryCompact = normalizeCompact(entryName);
  for (const item of normalizedAliases) {
    if (!item.aliasCompact) continue;
    if (entryKey.includes(item.aliasKey) || entryCompact.includes(item.aliasCompact)) {
      return item.member;
    }
  }

  // Only allow fuzzy fallback when aliases are not configured.
  if (!hasAliases) {
    return (
      subgroupMembers.find(
        (m) =>
          normalizeKey(entryName).includes(normalizeKey(m)) ||
          normalizeCompact(entryName).includes(normalizeCompact(m))
      ) || null
    );
  }

  return null;
}

function parseEventNameFromHtml(html) {
  const text = safeText(html);
  const deadlineMatch = text.match(/([A-Za-z0-9'&.\-\s]{5,80})\s+Pick Deadline/i);
  if (deadlineMatch) return deadlineMatch[1].trim();
  return "Current Tournament";
}

function parseLeagueNameFromHtml(html) {
  const headingMatch = String(html || "").match(/<h1[^>]*>\s*([^<]{4,80}?)\s*<\/h1>/i);
  if (headingMatch) return safeText(headingMatch[1]);

  const contestTitleMatch = String(html || "").match(/<div[^>]*class="[^"]*contest-title[^"]*"[^>]*>\s*([^<]{4,80}?)\s*<\/div>/i);
  if (contestTitleMatch) return safeText(contestTitleMatch[1]);

  const text = safeText(html);
  const top = text.match(/([A-Za-z0-9'&.\-\s]{4,80})\s+Standings/i);
  if (top) return top[1].trim();
  const alt = text.match(/([A-Za-z0-9'&.\-\s]{4,80})\s+WELCOME/i);
  if (alt) return alt[1].trim();
  return "Splash Sports League";
}

function lookupEventMetadata(eventName) {
  const key = normalizeCompact(canonicalizeEventName(eventName));

  if (key === "playerschampionship" || key === "theplayerschampionship") {
    return {
      tier: "signature",
      totalPurse: 25000000,
      firstPrize: 4500000,
      lastYearWinner: "Rory McIlroy",
      sourceNotes: [
        "Event metadata source: https://www.pgatour.com/tournaments/2025/the-players-championship/R20250112/overview",
        "Purse source: https://www.pgatour.com/article/news/latest/2025/03/10/purse-breakdown-prize-money-the-players-championship-tpc-sawgrass-scottie-scheffler?webview=1",
      ],
    };
  }

  if (key === "att" || key === "attpebblebeachproam") {
    return {
      tier: "signature",
      totalPurse: 20000000,
      firstPrize: 3600000,
      lastYearWinner: "Wyndham Clark",
      sourceNotes: [],
    };
  }

  if (key === "genesis" || key === "genesisinvitational") {
    return {
      tier: "signature",
      totalPurse: 20000000,
      firstPrize: 4000000,
      lastYearWinner: "Hideki Matsuyama",
      sourceNotes: [],
    };
  }

  if (key === "arnoldpalmer" || key === "arnoldpalmerinvitational") {
    return {
      tier: "signature",
      totalPurse: 20000000,
      firstPrize: 4000000,
      lastYearWinner: "Scottie Scheffler",
      sourceNotes: [],
    };
  }

  return {
    tier: "regular",
    totalPurse: 0,
    firstPrize: 0,
    lastYearWinner: "Unknown",
    sourceNotes: [],
  };
}

function looksLikeAuthPage(html) {
  const text = safeText(html).toLowerCase();
  return (
    text.includes("log in") ||
    text.includes("sign in") ||
    text.includes("password") ||
    text.includes("forgot password") ||
    text.includes("create account")
  );
}

function extractRows(html) {
  const rows = [];
  const trRegex = /<tr[\s\S]*?<\/tr>/gi;
  let match;
  while ((match = trRegex.exec(html)) !== null) {
    const raw = match[0];
    const text = safeText(raw);
    if (!text) continue;
    rows.push({ raw, text });
  }
  return rows;
}

function extractCells(trHtml) {
  const cells = [];
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = cellRegex.exec(trHtml)) !== null) {
    cells.push(safeText(m[1]));
  }
  return cells.filter(Boolean);
}

function extractTables(html) {
  const out = [];
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = tableRegex.exec(html)) !== null) {
    out.push(m[0]);
  }
  return out;
}

function extractTableById(html, tableId) {
  const marker = `id="${tableId}"`;
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const tableStart = html.lastIndexOf('<table', start);
  if (tableStart === -1) return null;

  const tableEnd = html.indexOf('</table>', start);
  if (tableEnd === -1) return null;

  return html.slice(tableStart, tableEnd + 8);
}

function stripHtmlTags(html) {
  return safeText(String(html || "").replace(/<img[\s\S]*?>/gi, " "));
}

function extractAttr(tagHtml, attrName) {
  const pattern = new RegExp(`${attrName}=(["'])([\\s\\S]*?)\\1`, "i");
  const match = String(tagHtml || "").match(pattern);
  return match ? match[2] : null;
}

function extractTableRows(tableHtml) {
  const rows = [];
  const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(tableHtml)) !== null) {
    rows.push(match[0]);
  }
  return rows;
}

function extractCellHtml(rowHtml) {
  const cells = [];
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let match;
  while ((match = cellRegex.exec(rowHtml)) !== null) {
    cells.push(match[1]);
  }
  return cells;
}

function parsePickFromPickCell(cellHtml) {
  const text = stripHtmlTags(cellHtml);
  if (!text || /^your pick for/i.test(text)) return null;
  if (/^edit pick$/i.test(text)) return null;
  if (/^winnings:/i.test(text) || /^fedex points:/i.test(text)) return null;

  const onclickMatch = String(cellHtml || "").match(/location\.href='[^']*entry_id=\d+'[\s\S]*?<table[\s\S]*?<\/table>/i);
  const candidates = text
    .split(/\s{2,}|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^edit pick$/i.test(part))
    .filter((part) => !/^winnings:/i.test(part))
    .filter((part) => !/^fedex points:/i.test(part));

  if (onclickMatch && candidates.length === 0) return null;
  if (candidates.length === 0) return null;
  return candidates[0];
}

function parsePicksFromEntryTable(html, subgroupMembers, memberAliases = {}) {
  const entryTable = extractTableById(html, "entryTable");
  if (!entryTable) return [];

  const out = [];
  for (const rowHtml of extractTableRows(entryTable)) {
    const rowTag = rowHtml.match(/<tr[^>]*>/i)?.[0] || "";
    if (!/entryRow/i.test(rowTag)) continue;

    const cells = extractCellHtml(rowHtml);
    if (cells.length < 3) continue;

    const entryCellText = stripHtmlTags(cells[0]);
    const entryName = entryCellText.split(/\s+/)[0] || entryCellText;
    const member = resolveMemberFromEntry(entryName, subgroupMembers, memberAliases);
    if (!member) continue;

    const pick = parsePickFromPickCell(cells[2]);
    const entryId = extractAttr(cells[2], "onClick")?.match(/entry_id=(\d+)/i)?.[1] || null;
    out.push({
      member,
      entryName,
      entryId,
      pick,
      earnings: 0,
      finish: null,
      leagueRank: null,
    });
  }

  const dedup = new Map();
  for (const item of out) dedup.set(item.member, item);
  return [...dedup.values()];
}

function parsePickHistoryHtml(html, member) {
  const tables = extractTables(html);
  const targetTable = tables.find((table) => {
    const rows = extractRows(table);
    const headerCells = extractCells(rows[0]?.raw || "");
    const lower = headerCells.map((c) => normalizeKey(c));
    return lower.includes("tourney") && lower.includes("pick") && lower.includes("position") && lower.includes("winnings");
  });

  if (!targetTable) return [];

  const rows = extractRows(targetTable);
  const out = [];
  let seenHeader = false;

  for (const row of rows) {
    const cells = extractCells(row.raw);
    if (cells.length < 5) continue;

    if (!seenHeader) {
      const lower = cells.map((c) => normalizeKey(c));
      if (lower.includes("tourney") && lower.includes("pick") && lower.includes("position") && lower.includes("winnings")) {
        seenHeader = true;
      }
      continue;
    }

    const eventName = canonicalizeEventName(cells[0] || "");
    const pick = cells[1] || null;
    if (!eventName || !pick) continue;

    out.push({
      member,
      eventId: normalizeEventId(eventName),
      eventName,
      pick,
      finish: cells[2] || null,
      earnings: matchMoneyLoose(cells[3]),
      scoreToPar: cells[4] || null,
      fedexPoints: cells[5] ? Number(String(cells[5]).replace(/,/g, "").trim()) || 0 : 0,
    });
  }

  return out;
}

function parsePicksFromEntriesHtml(html, subgroupMembers, memberAliases = {}) {
  const tablePicks = parsePicksFromEntryTable(html, subgroupMembers, memberAliases);
  if (tablePicks.length > 0) return tablePicks;

  const rows = extractRows(html);
  const parsed = [];

  for (const row of rows) {
    const cells = extractCells(row.raw);
    if (cells.length < 2) continue;

    const entryToken = cells.find((line) => /[A-Z0-9_]{4,}/.test(line)) || cells[0];
    const pickToken = [...cells]
      .reverse()
      .find((line) => !/^rename$/i.test(line) && !normalizeKey(line).includes(normalizeKey(entryToken)) && /[a-z]/i.test(line));

    const member = resolveMemberFromEntry(entryToken, subgroupMembers, memberAliases);

    if (!member || !pickToken) continue;

    parsed.push({
      member,
      pick: pickToken,
      earnings: 0,
      finish: null,
      leagueRank: null,
    });
  }

  // Keep unique member row with last seen pick.
  const dedup = new Map();
  for (const item of parsed) dedup.set(item.member, item);
  return [...dedup.values()];
}

function parseTournamentPicksFromStandingsHtml(html, subgroupMembers, memberAliases = {}) {
  const targetTable = extractTableById(html, "tournamentTable");
  if (!targetTable) return [];

  const rows = extractRows(targetTable);
  const out = [];
  let seenHeader = false;

  for (const row of rows) {
    const cells = extractCells(row.raw);
    if (cells.length < 5) continue;

    if (!seenHeader) {
      const lower = cells.map((c) => normalizeKey(c));
      if (lower.includes("entry name") && lower.includes("player picked")) {
        seenHeader = true;
      }
      continue;
    }

    const entryName = cells[1] || "";
    const member = resolveMemberFromEntry(entryName, subgroupMembers, memberAliases);
    if (!member) continue;

    out.push({
      member,
      pick: cells[2] || null,
      earnings: matchMoneyLoose(cells[4]),
      finish: cells[3] || null,
      leagueRank: /^\d{1,3}$/.test((cells[0] || "").trim()) ? Number(cells[0].trim()) : null,
    });
  }

  const dedup = new Map();
  for (const row of out) dedup.set(row.member, row);
  return [...dedup.values()];
}

function parseLeagueWideTournamentPicksFromStandingsHtml(html) {
  const targetTable = extractTableById(html, "tournamentTable");
  if (!targetTable) return [];

  const rows = extractRows(targetTable);
  const out = [];
  let seenHeader = false;

  for (const row of rows) {
    const cells = extractCells(row.raw);
    if (cells.length < 5) continue;

    if (!seenHeader) {
      const lower = cells.map((c) => normalizeKey(c));
      if (lower.includes("entry name") && lower.includes("player picked")) {
        seenHeader = true;
      }
      continue;
    }

    const entryName = String(cells[1] || "").trim();
    const pick = String(cells[2] || "").trim();
    const finish = String(cells[3] || "").trim() || null;
    if (!entryName || !pick) continue;

    out.push({
      entryName,
      pick,
      earnings: matchMoneyLoose(cells[4]),
      finish,
      leagueRank: /^\d{1,4}$/.test((cells[0] || "").trim()) ? Number(cells[0].trim()) : null,
    });
  }

  return out;
}

function aggregateLeagueWidePicks(rows = []) {
  const byGolfer = new Map();

  for (const row of rows) {
    const pick = String(row?.pick || "").trim();
    if (!pick) continue;
    const key = normalizeKey(pick);
    const current = byGolfer.get(key) || {
      golfer: pick,
      pickCount: 0,
      finish: null,
      earnings: 0,
      sampleLeagueRank: null,
    };

    current.pickCount += 1;

    if (!current.finish && row.finish) current.finish = row.finish;
    if (!Number(current.earnings) && Number(row.earnings || 0)) current.earnings = Number(row.earnings || 0);
    if (current.sampleLeagueRank == null && Number.isFinite(Number(row.leagueRank))) {
      current.sampleLeagueRank = Number(row.leagueRank);
    }

    byGolfer.set(key, current);
  }

  return [...byGolfer.values()].sort((a, b) => {
    if (b.pickCount !== a.pickCount) return b.pickCount - a.pickCount;
    if (Number(b.earnings || 0) !== Number(a.earnings || 0)) return Number(b.earnings || 0) - Number(a.earnings || 0);
    return a.golfer.localeCompare(b.golfer);
  });
}

function buildLeagueWideEventSummary({
  eventName,
  tournamentRows,
  countsTowardSeasonTotals = true,
}) {
  const canonicalEventName = canonicalizeEventName(eventName);
  const eventMeta = lookupEventMetadata(canonicalEventName);
  const leagueRows = Array.isArray(tournamentRows) ? aggregateLeagueWidePicks(tournamentRows) : [];

  return {
    eventId: normalizeEventId(canonicalEventName),
    eventName: canonicalEventName,
    tier: eventMeta.tier,
    startDate: null,
    countsTowardSeasonTotals,
    totalPurse: eventMeta.totalPurse,
    firstPrize: eventMeta.firstPrize,
    totalEntrants: Array.isArray(tournamentRows) ? tournamentRows.filter((row) => row?.pick).length : 0,
    rows: leagueRows,
  };
}

function parseTournamentOptionsFromStandingsHtml(html) {
  const match = html.match(/<select[^>]*name=["']tournamentId["'][^>]*>([\s\S]*?)<\/select>/i);
  if (!match) return [];

  const options = [];
  const optionRegex = /<option\b([^>]*)value=["']?([^"'>\s]+)["']?([^>]*)>([\s\S]*?)<\/option>/gi;
  let optionMatch;
  while ((optionMatch = optionRegex.exec(match[1]))) {
    const attrs = `${optionMatch[1]} ${optionMatch[3]}`;
    options.push({
      value: String(optionMatch[2] || "").trim(),
      label: stripHtmlTags(optionMatch[4] || "").trim(),
      selected: /\bselected\b/i.test(attrs),
      disabled: /\bdisabled\b/i.test(attrs),
    });
  }

  return options;
}

function buildSupplementalEventFromStandingsPage({
  standingsHtml,
  tournamentName,
  subgroupMembers,
  memberAliases = {},
  standingsRows = [],
}) {
  const tournamentRows = parseTournamentPicksFromStandingsHtml(standingsHtml, subgroupMembers, memberAliases);
  if (!tournamentRows.length) return null;

  const canonicalName = canonicalizeEventName(tournamentName);
  const eventMeta = lookupEventMetadata(canonicalName);
  const standingsMap = new Map((standingsRows || []).map((row) => [row.member, row]));

  const subgroupResults = subgroupMembers.map((member) => {
    const tournamentRow = tournamentRows.find((row) => row.member === member) || {};
    const standingsRow = standingsMap.get(member) || {};
    return {
      member,
      pick: tournamentRow.pick || null,
      earnings: Number(tournamentRow.earnings || 0),
      seasonEarnings: 0,
      finish: tournamentRow.finish ?? null,
      leagueRank: standingsRow.leagueRank ?? null,
    };
  });

  return {
    id: normalizeEventId(canonicalName),
    name: canonicalName,
    tier: eventMeta.tier,
    startDate: null,
    isUpcoming: false,
    countsTowardSeasonTotals: true,
    totalPurse: eventMeta.totalPurse,
    firstPrize: eventMeta.firstPrize,
    subgroupResults,
    picks: subgroupResults.map((row) => ({
      member: row.member,
      golfer: row.pick,
      earnings: row.earnings,
      seasonEarnings: row.seasonEarnings,
      finish: row.finish,
      leagueRank: row.leagueRank,
    })),
  };
}

function parseStandingsFromHtml(html, subgroupMembers, memberAliases = {}) {
  const targetTable = extractTableById(html, "ytdTable");
  if (!targetTable) return [];

  const rows = extractRows(targetTable);
  const out = [];
  let seenHeader = false;

  for (const row of rows) {
    const cells = extractCells(row.raw);
    if (cells.length < 6) continue;

    if (!seenHeader) {
      const lower = cells.map((c) => normalizeKey(c));
      if (lower.includes("entry name") && lower.includes("winnings")) {
        seenHeader = true;
      }
      continue;
    }

    const entryName = cells[1] || "";
    const member = resolveMemberFromEntry(entryName, subgroupMembers, memberAliases);
    if (!member) continue;

    const fedexPoints = Number(String(cells[4] || "").replace(/,/g, "").trim());

    out.push({
      member,
      earnings: matchMoneyLoose(cells[2]),
      leagueRank: /^\d{1,3}$/.test((cells[0] || "").trim()) ? Number(cells[0].trim()) : null,
      finish: null,
      fedexPoints: Number.isFinite(fedexPoints) ? fedexPoints : null,
    });
  }

  const dedup = new Map();
  for (const row of out) dedup.set(row.member, row);
  return [...dedup.values()];
}

export async function fetchRunYourPoolData({ baseUrl, cookie, leagueId }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/one-and-done/${leagueId}/snapshot`;
  const response = await fetchOrThrow(url, {
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "User-Agent": "OneAndDoneCompanion/1.0",
    },
  }, "RunYourPool");

  if (response.status === 401 || response.status === 403) {
    throw new SyncError("RunYourPool session expired. Refresh cookie and retry.", "AUTH_EXPIRED");
  }

  if (!response.ok) {
    throw new SyncError(`RunYourPool sync failed with HTTP ${response.status}`, "HTTP_ERROR");
  }

  return response.json();
}

export async function fetchSplashSportsData({
  baseUrl,
  cookie,
  leaguePath,
  standingsPath,
  subgroupMembers,
  memberAliases,
  entryIds = {},
}) {
  const base = baseUrl.replace(/\/$/, "");
  const entriesUrl = leaguePath.startsWith("http") ? leaguePath : `${base}${leaguePath.startsWith("/") ? "" : "/"}${leaguePath}`;
  const standingsUrl = standingsPath
    ? (standingsPath.startsWith("http") ? standingsPath : `${base}${standingsPath.startsWith("/") ? "" : "/"}${standingsPath}`)
    : entriesUrl.replace(/multiple_entries\.cfm/i, "standings.cfm");

  const headers = {
    Cookie: cookie,
    Accept: "text/html,application/xhtml+xml",
    "User-Agent": "OneAndDoneCompanion/1.0",
  };

  const entriesRes = await fetchOrThrow(entriesUrl, { headers }, "Splash entries");
  if (entriesRes.status === 401 || entriesRes.status === 403) {
    throw new SyncError("Splash Sports session expired. Refresh cookie and retry.", "AUTH_EXPIRED");
  }
  if (!entriesRes.ok) {
    throw new SyncError(`Splash entries fetch failed with HTTP ${entriesRes.status}`, "HTTP_ERROR");
  }
  const entriesHtml = await entriesRes.text();
  if (looksLikeAuthPage(entriesHtml)) {
    await writeDebugHtml("debug-splash-entries-auth", entriesHtml);
    throw new SyncError("Splash Sports session appears expired (entries page is auth/login).", "AUTH_EXPIRED");
  }

  let standingsHtml = "";
  const standingsRes = await fetchOrThrow(standingsUrl, { headers }, "Splash standings");
  if (standingsRes.ok) {
    standingsHtml = await standingsRes.text();
    if (looksLikeAuthPage(standingsHtml)) {
      await writeDebugHtml("debug-splash-standings-auth", standingsHtml);
      throw new SyncError("Splash Sports session appears expired (standings page is auth/login).", "AUTH_EXPIRED");
    }
  }

  const eventName = parseEventNameFromHtml(entriesHtml);
  const leagueName = parseLeagueNameFromHtml(entriesHtml);
  const entryPicks = parsePicksFromEntriesHtml(entriesHtml, subgroupMembers, memberAliases);
  const standingsPagePicks = standingsHtml
    ? parseTournamentPicksFromStandingsHtml(standingsHtml, subgroupMembers, memberAliases)
    : [];
  const pickMap = new Map();
  for (const item of entryPicks) {
    pickMap.set(item.member, { ...item });
  }
  for (const item of standingsPagePicks) {
    const current = pickMap.get(item.member) || {};
    pickMap.set(item.member, {
      ...current,
      ...item,
      pick: item.pick || current.pick || null,
      earnings: Number.isFinite(item.earnings) ? item.earnings : Number(current.earnings || 0),
      finish: item.finish ?? current.finish ?? null,
    });
  }
  const picks = [...pickMap.values()];
  const standings = standingsHtml
    ? parseStandingsFromHtml(standingsHtml, subgroupMembers, memberAliases)
    : [];
  const pickHistoryByMember = {};

  for (const [member, entryId] of Object.entries(entryIds || {})) {
    if (!entryId) continue;
    const historyUrl = `${base}/Golf/PickX/modal/pickHistory.cfm?entryId=${encodeURIComponent(entryId)}`;
    const historyRes = await fetchOrThrow(historyUrl, { headers }, `Splash pick history (${member})`);
    if (!historyRes.ok) continue;
    const historyHtml = await historyRes.text();
    if (looksLikeAuthPage(historyHtml)) {
      await writeDebugHtml(`debug-splash-history-auth-${String(member).toLowerCase()}`, historyHtml);
      throw new SyncError("Splash Sports session appears expired (pick history page is auth/login).", "AUTH_EXPIRED");
    }
    pickHistoryByMember[member] = historyHtml;
  }
  let supplementalEvents = [];
  let leagueWideHistory = standingsHtml
    ? [buildLeagueWideEventSummary({
      eventName,
      tournamentRows: parseLeagueWideTournamentPicksFromStandingsHtml(standingsHtml),
      countsTowardSeasonTotals: false,
    })]
    : [];

  if (standingsHtml) {
    const tournamentOptions = parseTournamentOptionsFromStandingsHtml(standingsHtml)
      .filter((option) => option?.value && !option.disabled);
    const selectedLabel = tournamentOptions.find((option) => option.selected)?.label;

    for (const option of tournamentOptions) {
      if (option.label === selectedLabel) continue;
      const optionStandingsUrl = `${base}/Golf/PickX/reports/pickone/standings_v2.cfm?tournamentId=${encodeURIComponent(option.value)}`;
      const optionRes = await fetchOrThrow(optionStandingsUrl, { headers }, `Splash standings (${option.label})`);
      if (!optionRes.ok) continue;
      const optionHtml = await optionRes.text();
      if (looksLikeAuthPage(optionHtml)) continue;
      const optionRows = parseLeagueWideTournamentPicksFromStandingsHtml(optionHtml);
      if (!optionRows.length) continue;
      leagueWideHistory.push(buildLeagueWideEventSummary({
        eventName: option.label,
        tournamentRows: optionRows,
        countsTowardSeasonTotals: true,
      }));
    }
  }

  if (standingsHtml && standingsPagePicks.length < subgroupMembers.length) {
    const tournamentOptions = parseTournamentOptionsFromStandingsHtml(standingsHtml);
    const selectedIndex = tournamentOptions.findIndex((option) => option.selected);
    const previousCompletedOption =
      selectedIndex > 0
        ? [...tournamentOptions.slice(0, selectedIndex)].reverse().find((option) => !option.disabled)
        : null;

    if (previousCompletedOption?.value) {
      const previousStandingsUrl = `${base}/Golf/PickX/reports/pickone/standings_v2.cfm?tournamentId=${encodeURIComponent(previousCompletedOption.value)}`;
      const previousRes = await fetchOrThrow(previousStandingsUrl, { headers }, "Splash previous tournament standings");
      if (previousRes.ok) {
        const previousStandingsHtml = await previousRes.text();
        if (!looksLikeAuthPage(previousStandingsHtml)) {
          const supplementalEvent = buildSupplementalEventFromStandingsPage({
            standingsHtml: previousStandingsHtml,
            tournamentName: previousCompletedOption.label,
            subgroupMembers,
            memberAliases,
            standingsRows: standings,
          });
          if (supplementalEvent) {
            supplementalEvents = [supplementalEvent];
          }
        }
      }
    }
  }

  if (picks.length === 0 && standings.length === 0) {
    await writeDebugHtml("debug-splash-entries-parse-empty", entriesHtml);
    await writeDebugHtml("debug-splash-standings-parse-empty", standingsHtml);
    throw new SyncError(
      "Splash parser returned zero picks and zero standings rows. Cookie/session likely expired or page markup changed.",
      "PARSE_EMPTY"
    );
  }

  return buildSplashSnapshot({
    leaguePath,
    entriesUrl,
    standingsUrl,
    eventName,
    leagueName,
    picks,
    standings,
    supplementalEvents,
    leagueWideHistory,
    pickHistory: Object.fromEntries(
      Object.entries(pickHistoryByMember).map(([member, html]) => [member, parsePickHistoryHtml(html, member)])
    ),
    subgroupMembers,
  });
}

export function parseSplashSportsHtml({
  baseUrl,
  leaguePath,
  standingsPath,
  subgroupMembers,
  memberAliases,
  pickHistoryByMember = {},
  entriesHtml,
  standingsHtml = "",
}) {
  const base = baseUrl.replace(/\/$/, "");
  const entriesUrl = leaguePath.startsWith("http") ? leaguePath : `${base}${leaguePath.startsWith("/") ? "" : "/"}${leaguePath}`;
  const resolvedStandingsUrl = standingsPath
    ? (standingsPath.startsWith("http") ? standingsPath : `${base}${standingsPath.startsWith("/") ? "" : "/"}${standingsPath}`)
    : entriesUrl.replace(/multiple_entries\.cfm/i, "standings.cfm");

  if (looksLikeAuthPage(entriesHtml)) {
    throw new SyncError("Splash Sports session appears expired (entries page is auth/login).", "AUTH_EXPIRED");
  }
  if (standingsHtml && looksLikeAuthPage(standingsHtml)) {
    throw new SyncError("Splash Sports session appears expired (standings page is auth/login).", "AUTH_EXPIRED");
  }

  const eventName = parseEventNameFromHtml(entriesHtml);
  const leagueName = parseLeagueNameFromHtml(entriesHtml);
  const entryPicks = parsePicksFromEntriesHtml(entriesHtml, subgroupMembers, memberAliases);
  const standingsPagePicks = standingsHtml
    ? parseTournamentPicksFromStandingsHtml(standingsHtml, subgroupMembers, memberAliases)
    : [];
  const pickMap = new Map();
  for (const item of entryPicks) {
    pickMap.set(item.member, { ...item });
  }
  for (const item of standingsPagePicks) {
    const current = pickMap.get(item.member) || {};
    pickMap.set(item.member, {
      ...current,
      ...item,
      pick: item.pick || current.pick || null,
      earnings: Number.isFinite(item.earnings) ? item.earnings : Number(current.earnings || 0),
      finish: item.finish ?? current.finish ?? null,
    });
  }
  const picks = [...pickMap.values()];
  const standings = standingsHtml
    ? parseStandingsFromHtml(standingsHtml, subgroupMembers, memberAliases)
    : [];
  const leagueWideHistory = standingsHtml
    ? [buildLeagueWideEventSummary({
      eventName,
      tournamentRows: parseLeagueWideTournamentPicksFromStandingsHtml(standingsHtml),
      countsTowardSeasonTotals: false,
    })]
    : [];
  const seasonSchedule = standingsHtml ? parseTournamentOptionsFromStandingsHtml(standingsHtml) : [];
  const pickHistory = Object.fromEntries(
    Object.entries(pickHistoryByMember || {}).map(([member, html]) => [member, parsePickHistoryHtml(html, member)])
  );

  if (picks.length === 0 && standings.length === 0) {
    throw new SyncError(
      "Splash parser returned zero picks and zero standings rows. Cookie/session likely expired or page markup changed.",
      "PARSE_EMPTY"
    );
  }

  return buildSplashSnapshot({
    leaguePath,
    entriesUrl,
    standingsUrl: resolvedStandingsUrl,
    eventName,
    leagueName,
    picks,
    standings,
    leagueWideHistory,
    pickHistory,
    subgroupMembers,
    seasonSchedule,
  });
}

export function buildSplashSnapshot({
  leaguePath,
  entriesUrl,
  standingsUrl,
  eventName,
  leagueName,
  picks,
  standings,
  supplementalEvents = [],
  leagueWideHistory = [],
  pickHistory = {},
  subgroupMembers,
  seasonSchedule = [],
}) {
  const canonicalCurrentEventName = canonicalizeEventName(eventName);
  const eventMeta = lookupEventMetadata(canonicalCurrentEventName);
  const standingsMap = new Map(standings.map((s) => [s.member, s]));
  const pickMap = new Map(picks.map((p) => [p.member, p]));
  const nowEt = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const weekday = nowEt.getDay();
  const minutes = nowEt.getHours() * 60 + nowEt.getMinutes();
  const currentEventCountsTowardSeason =
    weekday === 0 ? minutes >= 20 * 60 : weekday >= 1 && weekday <= 3;

  const mergedPicks = subgroupMembers.map((member) => {
    const p = pickMap.get(member) || {};
    const s = standingsMap.get(member) || {};
    return {
      member,
      golfer: p.pick || null,
      earnings: Number.isFinite(p.earnings) ? p.earnings : 0,
      seasonEarnings: Number.isFinite(s.earnings) ? s.earnings : 0,
      finish: p.finish ?? null,
      leagueRank: s.leagueRank ?? null,
    };
  });
  const mappingDebug = mergedPicks.map(
    (row) =>
      `${row.member}: rank=${row.leagueRank ?? "-"}, season=${Number(row.seasonEarnings || 0)}, pick=${row.golfer || "-"}, week=${Number(row.earnings || 0)}, finish=${row.finish ?? "-"}`
  );
  const eventOrder = [];
  const historicalByEvent = new Map();

  for (const member of subgroupMembers) {
    for (const row of pickHistory[member] || []) {
      const canonicalEventName = canonicalizeEventName(row.eventName);
      const canonicalEventId = normalizeEventId(canonicalEventName);

      if (!historicalByEvent.has(canonicalEventId)) {
        eventOrder.push(canonicalEventId);
        const meta = lookupEventMetadata(canonicalEventName);
        historicalByEvent.set(canonicalEventId, {
          id: canonicalEventId,
          name: canonicalEventName,
          tier: meta.tier,
          startDate: null,
          isUpcoming: false,
          countsTowardSeasonTotals: true,
          totalPurse: meta.totalPurse,
          firstPrize: meta.firstPrize,
          subgroupResults: subgroupMembers.map((name) => ({
            member: name,
            pick: null,
            earnings: 0,
            seasonEarnings: 0,
            finish: null,
            leagueRank: null,
          })),
          picks: subgroupMembers.map((name) => ({
            member: name,
            golfer: null,
            earnings: 0,
            seasonEarnings: 0,
            finish: null,
            leagueRank: null,
          })),
        });
      }

      const event = historicalByEvent.get(canonicalEventId);
      const result = event.subgroupResults.find((item) => item.member === member);
      const pickResult = event.picks.find((item) => item.member === member);
      Object.assign(result, {
        pick: row.pick,
        earnings: row.earnings,
        finish: row.finish,
      });
      Object.assign(pickResult, {
        golfer: row.pick,
        earnings: row.earnings,
        finish: row.finish,
      });
    }
  }

  const seasonEventMap = new Map(eventOrder.map((id) => [id, historicalByEvent.get(id)]).filter(([, event]) => Boolean(event)));
  for (const event of supplementalEvents || []) {
    if (!event?.id) continue;
    seasonEventMap.set(event.id, event);
  }
  const seasonEvents = [...seasonEventMap.values()];
  const currentEventId = normalizeEventId(canonicalCurrentEventName);
  const includeCurrentEvent = shouldIncludeCurrentEventSnapshot(canonicalCurrentEventName, mergedPicks);
  const currentEvent = {
    id: currentEventId,
    name: canonicalCurrentEventName,
    tier: eventMeta.tier,
    startDate: null,
    isUpcoming: true,
    countsTowardSeasonTotals: currentEventCountsTowardSeason,
    totalPurse: eventMeta.totalPurse,
    firstPrize: eventMeta.firstPrize,
    subgroupResults: mergedPicks.map((pick) => ({
      member: pick.member,
      pick: pick.golfer,
      earnings: pick.earnings,
      seasonEarnings: pick.seasonEarnings,
      finish: pick.finish,
      leagueRank: pick.leagueRank,
    })),
    picks: mergedPicks,
  };

  let replacedCurrent = false;
  const events = seasonEvents.map((event) => {
    if (!includeCurrentEvent) return event;
    if (event.id !== currentEventId) return event;
    replacedCurrent = true;
    return currentEvent;
  });
  if (includeCurrentEvent && !replacedCurrent) {
    events.push(currentEvent);
  }

  const seasonTotals = new Map(subgroupMembers.map((member) => [member, 0]));
  const explicitSeasonTotals = new Map(mergedPicks.map((pick) => [pick.member, Number(pick.seasonEarnings || 0)]));
  const hasExplicitSeasonTotals = [...explicitSeasonTotals.values()].some((value) => value > 0);
  for (const event of events) {
    const countsTowardSeasonTotals = event.countsTowardSeasonTotals !== false;
    for (const row of event.subgroupResults) {
      const next = seasonTotals.get(row.member) + (countsTowardSeasonTotals ? Number(row.earnings || 0) : 0);
      seasonTotals.set(row.member, next);
      row.seasonEarnings = hasExplicitSeasonTotals ? explicitSeasonTotals.get(row.member) || 0 : next;
    }
    for (const row of event.picks) {
      row.seasonEarnings = hasExplicitSeasonTotals
        ? explicitSeasonTotals.get(row.member) || 0
        : seasonTotals.get(row.member) || 0;
    }
  }

  return {
    league: {
      id: leaguePath,
      name: leagueName,
      totalEntrants: 150,
      yourRank: mergedPicks.find((p) => p.member === "Andrew")?.leagueRank || seasonEvents.at(-1)?.subgroupResults?.find((p) => p.member === "Andrew")?.leagueRank || 0,
      latestEventId: includeCurrentEvent ? currentEventId : seasonEvents.at(-1)?.id || currentEventId,
    },
    events,
    nextTournament: {
      id: includeCurrentEvent ? currentEventId : seasonEvents.at(-1)?.id || currentEventId,
      name: includeCurrentEvent ? eventName : seasonEvents.at(-1)?.name || eventName,
      tier: eventMeta.tier,
      startDate: null,
      totalPurse: eventMeta.totalPurse,
      firstPrize: eventMeta.firstPrize,
      lastYearWinner: eventMeta.lastYearWinner,
    },
    seasonSchedule: (seasonSchedule || []).map((item) => ({
      value: item?.value || null,
      label: canonicalizeEventName(item?.label || ""),
      selected: Boolean(item?.selected),
      disabled: Boolean(item?.disabled),
    })),
    projections: [],
    leagueWideHistory,
    sourceNotes: [
      `Splash entries source: ${entriesUrl}`,
      `Splash standings source: ${standingsUrl}`,
      `Splash parsed picks: ${picks.length}`,
      `Splash parsed standings rows: ${standings.length}`,
      `Splash parsed league-wide event summaries: ${leagueWideHistory.length}`,
      `Splash parsed history rows: ${Object.values(pickHistory).reduce((sum, rows) => sum + rows.length, 0)}`,
      `Splash mapping: ${mappingDebug.join(" | ")}`,
      ...eventMeta.sourceNotes,
    ],
  };
}

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function parseTournamentActivationTime(startDateText, referenceDate = new Date()) {
  const match = String(startDateText || "").match(/([A-Za-z]{3,9})\s+(\d{1,2})/);
  if (!match) return null;

  const monthMap = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const month = monthMap[match[1].slice(0, 3).toLowerCase()];
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isFinite(day)) return null;

  const candidate = new Date(referenceDate.getFullYear(), month, day, 8, 0, 0, 0);
  if (candidate.getTime() < referenceDate.getTime() - 180 * 24 * 60 * 60 * 1000) {
    candidate.setFullYear(candidate.getFullYear() + 1);
  } else if (candidate.getTime() > referenceDate.getTime() + 180 * 24 * 60 * 60 * 1000) {
    candidate.setFullYear(candidate.getFullYear() - 1);
  }
  return candidate;
}

export function shouldActivateCurrentWeekWindow(nextTournament, referenceDate = new Date()) {
  if (!nextTournament?.name) return false;
  const activationTime = parseTournamentActivationTime(nextTournament.startDate, referenceDate);
  if (!activationTime) return false;
  return referenceDate.getTime() >= activationTime.getTime();
}

export function shouldIncludeCurrentEventSnapshot(eventName, mergedPicks) {
  const canonicalName = canonicalizeEventName(eventName);
  if (canonicalName === "Current Tournament") return false;
  return (mergedPicks || []).some(
    (row) =>
      row?.golfer ||
      Number(row?.earnings || 0) > 0 ||
      row?.finish !== null && row?.finish !== undefined
  );
}

export function normalizeSnapshot(raw, subgroupMembers) {
  const warnings = [];
  const events = Array.isArray(raw.events) ? raw.events : [];
  const leagueWideHistory = Array.isArray(raw.leagueWideHistory) ? raw.leagueWideHistory : [];

  if (!raw.league) warnings.push("Missing league context in upstream response.");
  if (events.length === 0) warnings.push("No event history returned; dashboard will show empty season state.");

  const subgroupSet = new Set(subgroupMembers);

  const normalizedEvents = events.map((event) => {
    const canonicalName = canonicalizeEventName(event.name);
    const picks = Array.isArray(event.picks) ? event.picks : [];
    const subgroupResults = picks
      .filter((pick) => subgroupSet.has(pick.member))
      .map((pick) => ({
        member: pick.member,
        pick: pick.golfer,
        earnings: Number(pick.earnings || 0),
        seasonEarnings: Number(pick.seasonEarnings || 0),
        finish: pick.finish ?? null,
        leagueRank: pick.leagueRank ?? null,
      }));

    return {
      id: normalizeEventId(event.id || canonicalName),
      name: canonicalName,
      tier: event.tier || "regular",
      startDate: event.startDate || null,
      isUpcoming: Boolean(event.isUpcoming),
      countsTowardSeasonTotals: event.countsTowardSeasonTotals !== false,
      totalPurse: money(event.totalPurse),
      firstPrize: money(event.firstPrize),
      subgroupResults,
      picks,
    };
  });

  const projections = Array.isArray(raw.projections) ? raw.projections : [];
  if (projections.length === 0) {
    warnings.push("No projections returned. Recommendation engine will use fallback estimates.");
  }

  const explicitNext = raw.nextTournament;
  const inferredNext = normalizedEvents.find((event) => event.isUpcoming) || normalizedEvents.at(-1) || null;
  const nextTournament = explicitNext
    ? {
        id: explicitNext.id || inferredNext?.id || null,
        name: explicitNext.name || inferredNext?.name || "TBD",
        tier: explicitNext.tier || inferredNext?.tier || "regular",
        startDate: explicitNext.startDate || inferredNext?.startDate || null,
        totalPurse: money(explicitNext.totalPurse ?? inferredNext?.totalPurse),
        firstPrize: money(explicitNext.firstPrize ?? inferredNext?.firstPrize),
        lastYearWinner: explicitNext.lastYearWinner || "Unknown",
      }
    : inferredNext
      ? {
          id: inferredNext.id,
          name: inferredNext.name,
          tier: inferredNext.tier,
          startDate: inferredNext.startDate,
          totalPurse: inferredNext.totalPurse,
          firstPrize: inferredNext.firstPrize,
          lastYearWinner: "Unknown",
        }
      : null;

  return {
    league: {
      id: raw.league?.id || null,
      name: raw.league?.name || "One and Done League",
      totalEntrants: Number(raw.league?.totalEntrants || 150),
      yourRank: Number(raw.league?.yourRank || 0),
      latestEventId: raw.league?.latestEventId || normalizedEvents.at(-1)?.id || null,
    },
    events: normalizedEvents,
    seasonSchedule: (raw.seasonSchedule || []).map((item) => ({
      value: item?.value || null,
      label: canonicalizeEventName(item?.label || ""),
      selected: Boolean(item?.selected),
      disabled: Boolean(item?.disabled),
    })),
    leagueWideHistory: leagueWideHistory.map((event) => ({
      eventId: normalizeEventId(event.eventId || event.eventName || event.name),
      eventName: canonicalizeEventName(event.eventName || event.name),
      tier: event.tier || "regular",
      startDate: event.startDate || null,
      countsTowardSeasonTotals: event.countsTowardSeasonTotals !== false,
      totalPurse: money(event.totalPurse),
      firstPrize: money(event.firstPrize),
      totalEntrants: Number(event.totalEntrants || 0),
      rows: (event.rows || []).map((row) => ({
        golfer: row.golfer || null,
        pickCount: Number(row.pickCount || 0),
        finish: row.finish ?? null,
        earnings: money(row.earnings),
      })),
    })),
    nextTournament,
    projections,
    sourceNotes: raw.sourceNotes || [],
    warnings,
    lastSyncedAt: new Date().toISOString(),
  };
}

export async function loadCookie(cookiePath) {
  const raw = await fs.readFile(cookiePath, "utf8");
  return normalizeCookieInput(raw);
}
