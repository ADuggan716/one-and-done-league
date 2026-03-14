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

async function fetchSchedule() {
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

  const tournaments = await fetchSchedule();
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
