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
