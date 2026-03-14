import fs from "node:fs/promises";

export class SyncError extends Error {
  constructor(message, code = "SYNC_ERROR") {
    super(message);
    this.code = code;
  }
}

function formatFetchError(error) {
  const bits = [error?.message || "fetch failed"];
  if (error?.cause?.code) bits.push(`code=${error.cause.code}`);
  if (error?.cause?.errno) bits.push(`errno=${error.cause.errno}`);
  if (error?.cause?.syscall) bits.push(`syscall=${error.cause.syscall}`);
  if (error?.cause?.hostname) bits.push(`host=${error.cause.hostname}`);
  return bits.join(" | ");
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

function normalizeEventId(value) {
  return String(value || "")
    .trim()
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
  const key = normalizeCompact(eventName);

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

    const eventName = cells[0] || "";
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

  return buildSplashSnapshot({
    leaguePath,
    entriesUrl,
    standingsUrl,
    eventName,
    leagueName,
    picks,
    standings,
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
    pickHistory,
    subgroupMembers,
  });
}

function buildSplashSnapshot({
  leaguePath,
  entriesUrl,
  standingsUrl,
  eventName,
  leagueName,
  picks,
  standings,
  pickHistory = {},
  subgroupMembers,
}) {
  const eventMeta = lookupEventMetadata(eventName);
  const standingsMap = new Map(standings.map((s) => [s.member, s]));
  const pickMap = new Map(picks.map((p) => [p.member, p]));

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
      if (!historicalByEvent.has(row.eventId)) {
        eventOrder.push(row.eventId);
        const meta = lookupEventMetadata(row.eventName);
        historicalByEvent.set(row.eventId, {
          id: row.eventId,
          name: row.eventName,
          tier: meta.tier,
          startDate: null,
          isUpcoming: false,
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

      const event = historicalByEvent.get(row.eventId);
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

  const seasonEvents = eventOrder.map((id) => historicalByEvent.get(id)).filter(Boolean);
  const currentEventId = normalizeEventId(eventName);
  const currentEvent = {
    id: currentEventId,
    name: eventName,
    tier: eventMeta.tier,
    startDate: null,
    isUpcoming: true,
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
    if (event.id !== currentEventId) return event;
    replacedCurrent = true;
    return currentEvent;
  });
  if (!replacedCurrent) {
    events.push(currentEvent);
  }

  const seasonTotals = new Map(subgroupMembers.map((member) => [member, 0]));
  for (const event of events) {
    for (const row of event.subgroupResults) {
      const next = seasonTotals.get(row.member) + Number(row.earnings || 0);
      seasonTotals.set(row.member, next);
      row.seasonEarnings = next;
    }
    for (const row of event.picks) {
      row.seasonEarnings = seasonTotals.get(row.member) || 0;
    }
  }

  return {
    league: {
      id: leaguePath,
      name: leagueName,
      totalEntrants: 150,
      yourRank: mergedPicks.find((p) => p.member === "Andrew")?.leagueRank || 0,
      latestEventId: `${eventName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    },
    events,
    nextTournament: {
      id: currentEventId,
      name: eventName,
      tier: eventMeta.tier,
      startDate: null,
      totalPurse: eventMeta.totalPurse,
      firstPrize: eventMeta.firstPrize,
      lastYearWinner: eventMeta.lastYearWinner,
    },
    projections: [],
    sourceNotes: [
      `Splash entries source: ${entriesUrl}`,
      `Splash standings source: ${standingsUrl}`,
      `Splash parsed picks: ${picks.length}`,
      `Splash parsed standings rows: ${standings.length}`,
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

export function normalizeSnapshot(raw, subgroupMembers) {
  const warnings = [];
  const events = Array.isArray(raw.events) ? raw.events : [];

  if (!raw.league) warnings.push("Missing league context in upstream response.");
  if (events.length === 0) warnings.push("No event history returned; dashboard will show empty season state.");

  const subgroupSet = new Set(subgroupMembers);

  const normalizedEvents = events.map((event) => {
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
      id: event.id,
      name: event.name,
      tier: event.tier || "regular",
      startDate: event.startDate || null,
      isUpcoming: Boolean(event.isUpcoming),
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
    nextTournament,
    projections,
    sourceNotes: raw.sourceNotes || [],
    warnings,
    lastSyncedAt: new Date().toISOString(),
  };
}

export async function loadCookie(cookiePath) {
  const cookie = (await fs.readFile(cookiePath, "utf8")).trim();
  if (!cookie) {
    throw new SyncError("Cookie file is empty.", "COOKIE_EMPTY");
  }
  return cookie;
}
