import { fetchText } from "./online_signals.mjs";
import { normalizeGolferName } from "./player_pool.mjs";

const PGA_TOUR_SCHEDULE_URL = "https://www.pgatour.com/schedule";

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

function normalizeTournamentName(name) {
  return normalizeGolferName(name).replace(/^the\s+/, "");
}

function slugifyTournamentName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function parseMoney(value) {
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function inferTier(name, purse, fedexLabel) {
  const tournamentName = String(name || "");
  const purseAmount = parseMoney(purse);
  const fedex = String(fedexLabel || "");

  if (/masters|pga championship|u\.s\. open|open championship/i.test(tournamentName)) {
    return "major";
  }
  if (purseAmount >= 20000000 || /750\s*pts/i.test(fedex)) {
    return "signature";
  }
  return "regular";
}

export async function fetchPgaTourSchedule() {
  const html = await fetchText(PGA_TOUR_SCHEDULE_URL, {
    "User-Agent": "Mozilla/5.0",
    Accept: "text/html,application/xhtml+xml",
  });
  const data = extractNextData(html, "Schedule");
  const schedule = data?.props?.pageProps?.dehydratedState?.queries?.find((query) =>
    JSON.stringify(query?.queryKey || []).includes('"schedule"')
  )?.state?.data;

  if (!Array.isArray(schedule?.tournaments)) {
    throw new Error("Schedule: tournaments payload missing");
  }

  return schedule.tournaments;
}

export function resolveNextTournamentFromSchedule(tournaments, currentEventName, options = {}) {
  const list = Array.isArray(tournaments) ? tournaments.filter((tournament) => tournament?.display !== "HIDE") : [];
  if (!list.length) {
    throw new Error("Schedule: no tournaments available");
  }

  const currentKey = normalizeTournamentName(currentEventName);
  const currentIndex = list.findIndex((tournament) => normalizeTournamentName(tournament.name) === currentKey);
  const currentEventCompleted = Boolean(options.currentEventCompleted);

  let selectedIndex = currentIndex;
  if (currentIndex !== -1 && currentEventCompleted) {
    const nextIndex = list.findIndex((tournament, index) => index > currentIndex && tournament.status !== "COMPLETED");
    selectedIndex = nextIndex !== -1 ? nextIndex : currentIndex;
  }

  if (selectedIndex === -1) {
    selectedIndex = currentEventCompleted
      ? list.findIndex((tournament) => tournament.status === "UPCOMING")
      : list.findIndex((tournament) => tournament.status !== "COMPLETED");
    if (selectedIndex === -1) selectedIndex = list.length - 1;
  }

  const selected = list[selectedIndex];
  return {
    id: selected.tournamentId,
    name: selected.name,
    startDate: selected.displayDate || null,
    tier: inferTier(selected.name, selected.purse, selected.standings?.value),
    totalPurse: parseMoney(selected.purse),
    firstPrize: parseMoney(selected.championEarnings),
    lastYearWinner: selected.champions?.[0]?.displayName || "Unknown",
    status: selected.status || null,
  };
}

async function fetchFieldPage(url) {
  const html = await fetchText(url, {
    "User-Agent": "Mozilla/5.0",
    Accept: "text/html,application/xhtml+xml",
  });
  const data = extractNextData(html, "Field");
  const field = data?.props?.pageProps?.dehydratedState?.queries?.find((query) =>
    JSON.stringify(query?.queryKey || []).includes('"field"')
  )?.state?.data;

  if (!Array.isArray(field?.players)) {
    throw new Error("Field: players payload missing");
  }

  return field;
}

export async function fetchPgaTourTournamentField(eventName) {
  if (!eventName) {
    throw new Error("Event name is required to resolve PGA TOUR field data.");
  }

  const tournaments = await fetchPgaTourSchedule();
  const targetKey = normalizeTournamentName(eventName);
  const match = tournaments.find((tournament) => normalizeTournamentName(tournament.name) === targetKey);

  if (!match) {
    throw new Error(`Schedule: tournament not found for event "${eventName}"`);
  }

  const slug = slugifyTournamentName(match.name);
  const fieldUrl = `https://www.pgatour.com/tournaments/${match.year}/${slug}/${match.tournamentId}/field`;
  const field = await fetchFieldPage(fieldUrl);

  return {
    tournamentId: match.tournamentId,
    tournamentName: field.tournamentName || match.name,
    fieldUrl,
    playerNames: field.players
      .filter((player) => !player?.withdrawn && String(player?.status || "IN").toUpperCase() !== "WD")
      .map((player) => `${player.firstName || ""} ${player.lastName || ""}`.trim())
      .filter(Boolean),
  };
}
