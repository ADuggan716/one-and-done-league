import fs from "node:fs/promises";

export class SyncError extends Error {
  constructor(message, code = "SYNC_ERROR") {
    super(message);
    this.code = code;
  }
}

export async function readConfig(path) {
  const raw = await fs.readFile(path, "utf8");
  return JSON.parse(raw);
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

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function parseEventNameFromHtml(html) {
  const text = safeText(html);
  const deadlineMatch = text.match(/([A-Za-z0-9'&.\-\s]{5,80})\s+Pick Deadline/i);
  if (deadlineMatch) return deadlineMatch[1].trim();
  return "Current Tournament";
}

function parseLeagueNameFromHtml(html) {
  const text = safeText(html);
  const top = text.match(/([A-Za-z0-9'&.\-\s]{4,80})\s+Standings/i);
  if (top) return top[1].trim();
  const alt = text.match(/([A-Za-z0-9'&.\-\s]{4,80})\s+WELCOME/i);
  if (alt) return alt[1].trim();
  return "Splash Sports League";
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

function parsePicksFromEntriesHtml(html, subgroupMembers, memberAliases = {}) {
  const aliasMap = new Map(
    Object.entries(memberAliases).map(([k, v]) => [normalizeKey(k), String(v)])
  );

  const rows = extractRows(html);
  const parsed = [];

  for (const row of rows) {
    const cells = extractCells(row.raw);
    if (cells.length < 2) continue;

    const entryToken = cells.find((line) => /[A-Z0-9_]{4,}/.test(line)) || cells[0];
    const pickToken = [...cells]
      .reverse()
      .find((line) => !/^rename$/i.test(line) && !normalizeKey(line).includes(normalizeKey(entryToken)) && /[a-z]/i.test(line));

    const aliasMember = aliasMap.get(normalizeKey(entryToken));
    const inferredMember = subgroupMembers.find((m) => normalizeKey(entryToken).includes(normalizeKey(m)));
    const member = aliasMember || inferredMember;

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

function parseStandingsFromHtml(html, subgroupMembers, memberAliases = {}) {
  const aliasMap = new Map(
    Object.entries(memberAliases).map(([k, v]) => [normalizeKey(k), String(v)])
  );
  const rows = extractRows(html);
  const out = [];

  for (const row of rows) {
    const cells = extractCells(row.raw);
    const text = cells.join(" ");
    const currency = matchCurrency(text);
    const rankMatch = text.match(/\b(?:rank\s*)?(\d{1,3})\b/i);
    const finishMatch = text.match(/\b(?:T)?(\d{1,2}|MC|MDF)\b/i);

    let member = null;
    for (const [alias, name] of aliasMap.entries()) {
      if (normalizeKey(text).includes(alias)) {
        member = name;
        break;
      }
    }

    if (!member) {
      member = subgroupMembers.find((m) => normalizeKey(text).includes(normalizeKey(m))) || null;
    }

    if (!member) continue;

    out.push({
      member,
      earnings: currency,
      leagueRank: rankMatch ? Number(rankMatch[1]) : null,
      finish: finishMatch ? finishMatch[1] : null,
    });
  }

  const dedup = new Map();
  for (const row of out) dedup.set(row.member, row);
  return [...dedup.values()];
}

export async function fetchRunYourPoolData({ baseUrl, cookie, leagueId }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/one-and-done/${leagueId}/snapshot`;
  const response = await fetch(url, {
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "User-Agent": "OneAndDoneCompanion/1.0",
    },
  });

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

  const entriesRes = await fetch(entriesUrl, { headers });
  if (entriesRes.status === 401 || entriesRes.status === 403) {
    throw new SyncError("Splash Sports session expired. Refresh cookie and retry.", "AUTH_EXPIRED");
  }
  if (!entriesRes.ok) {
    throw new SyncError(`Splash entries fetch failed with HTTP ${entriesRes.status}`, "HTTP_ERROR");
  }
  const entriesHtml = await entriesRes.text();

  let standingsHtml = "";
  const standingsRes = await fetch(standingsUrl, { headers });
  if (standingsRes.ok) {
    standingsHtml = await standingsRes.text();
  }

  const eventName = parseEventNameFromHtml(entriesHtml);
  const leagueName = parseLeagueNameFromHtml(entriesHtml);
  const picks = parsePicksFromEntriesHtml(entriesHtml, subgroupMembers, memberAliases);
  const standings = standingsHtml
    ? parseStandingsFromHtml(standingsHtml, subgroupMembers, memberAliases)
    : [];
  const standingsMap = new Map(standings.map((s) => [s.member, s]));

  const mergedPicks = subgroupMembers.map((member) => {
    const p = picks.find((x) => x.member === member) || {};
    const s = standingsMap.get(member) || {};
    return {
      member,
      golfer: p.pick || null,
      earnings: Number.isFinite(s.earnings) ? s.earnings : 0,
      finish: s.finish ?? null,
      leagueRank: s.leagueRank ?? null,
    };
  });

  return {
    league: {
      id: leaguePath,
      name: leagueName,
      totalEntrants: 150,
      yourRank: mergedPicks.find((p) => p.member === "Andrew")?.leagueRank || 0,
      latestEventId: `${eventName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    },
    events: [
      {
        id: `${eventName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: eventName,
        tier: "regular",
        startDate: null,
        isUpcoming: true,
        totalPurse: 0,
        firstPrize: 0,
        picks: mergedPicks,
      },
    ],
    nextTournament: {
      id: `${eventName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: eventName,
      tier: "regular",
      startDate: null,
      totalPurse: 0,
      firstPrize: 0,
      lastYearWinner: "Unknown",
    },
    projections: [],
    sourceNotes: [
      `Splash entries source: ${entriesUrl}`,
      `Splash standings source: ${standingsUrl}`,
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
