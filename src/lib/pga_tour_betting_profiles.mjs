import { fetchText } from "./online_signals.mjs";
import { normalizeGolferName } from "./player_pool.mjs";

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

function extractNewsArticleDetails(html, label) {
  const data = extractNextData(html, label);
  const queries = data?.props?.pageProps?.dehydratedState?.queries || [];
  const details = queries.find((query) =>
    JSON.stringify(query?.queryKey || []).includes("newsArticleDetails")
  )?.state?.data;
  if (!details) {
    throw new Error(`${label}: newsArticleDetails payload missing`);
  }
  return details;
}

function textFromSegments(segments = []) {
  return segments
    .map((segment) => {
      if (segment?.value) return String(segment.value);
      if (Array.isArray(segment?.segments)) return textFromSegments(segment.segments);
      return "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function headerText(node) {
  const groups = node?.headerSegments || [];
  return groups
    .map((group) => textFromSegments(group?.segments || []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(node) {
  const rows = node?.table?.rows || [];
  return rows.map((row) =>
    (row?.columns || []).map((column) =>
      textFromSegments(column?.value || [])
    )
  );
}

function objectsFromTable(node) {
  const rows = tableRows(node);
  if (rows.length < 2) return [];
  const [header, ...body] = rows;
  return body.map((row) =>
    Object.fromEntries(header.map((key, index) => [key, row[index] || ""]))
  );
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

function tournamentYear(nextTournament) {
  const fromId = String(nextTournament?.id || "").match(/(\d{4})/);
  if (fromId) return fromId[1];
  return String(new Date().getFullYear());
}

function previewUrlForTournament(nextTournament) {
  const year = tournamentYear(nextTournament);
  const slug = slugifyTournamentName(nextTournament?.name);
  return `https://www.pgatour.com/article/news/betting-dfs/${year}/betting-profile/pga-tour-betting-odds-stats-${slug}-${year}`;
}

function splitNameParts(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || "",
    last: parts.at(-1) || "",
  };
}

function parseFinishValue(result) {
  const text = String(result || "").trim().toUpperCase();
  const match = text.match(/T?(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseFedexPoints(value) {
  const cleaned = String(value || "").replace(/,/g, "").trim();
  if (!cleaned || cleaned === "--") return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function courseHistoryScore(historyRows = []) {
  if (!historyRows.length) return undefined;
  const weighted = historyRows
    .map((row, index) => {
      const finish = parseFinishValue(row.finish);
      const madeCut = !/MC|WD|DQ/i.test(String(row.finish || ""));
      const base = finish ? Math.max(0, 1 - (finish - 1) / 60) : madeCut ? 0.35 : 0.12;
      const weight = Math.max(0.55, 1 - index * 0.12);
      return { base, weight };
    });
  const totalWeight = weighted.reduce((sum, row) => sum + row.weight, 0) || 1;
  const score = weighted.reduce((sum, row) => sum + row.base * row.weight, 0) / totalWeight;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function normalizeCategory(category) {
  const text = normalizeGolferName(category);
  if (text.includes("off-the-tee")) return "offTheTee";
  if (text.includes("approach")) return "approach";
  if (text.includes("around-the-green")) return "aroundTheGreen";
  if (text.includes("putting")) return "putting";
  if (text.includes("total")) return "total";
  return null;
}

function parseStrokesGainedTable(tableNode) {
  const rows = objectsFromTable(tableNode);
  const stats = {};
  for (const row of rows) {
    const key = normalizeCategory(row.Category);
    if (!key) continue;
    stats[key] = {
      overallRank: Number(row["Overall TOUR rank"]) || null,
      overall: Number(row.Overall) || null,
      lastFive: Number(row["Last five starts"]) || null,
    };
  }
  return Object.keys(stats).length ? stats : undefined;
}

function sectionMatcher(text, pattern) {
  return pattern.test(String(text || "").toLowerCase());
}

function findNextNode(nodes, startIndex, predicate) {
  for (let index = startIndex + 1; index < nodes.length; index += 1) {
    if (predicate(nodes[index])) return nodes[index];
    if (nodes[index]?.__typename === "NewsArticleHeader") break;
  }
  return null;
}

function parseProfileDetails(details) {
  const nodes = Array.isArray(details?.nodes) ? details.nodes : [];
  let historyRows = [];
  let recentResults = [];
  let strokesGained = undefined;
  let performanceNotes = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node?.__typename !== "NewsArticleHeader") continue;
    const title = headerText(node).toLowerCase();

    if (sectionMatcher(title, /recent history at the/)) {
      const tableNode = findNextNode(nodes, index, (candidate) => candidate?.__typename === "TableFragment");
      historyRows = objectsFromTable(tableNode).map((row) => ({
        year: row.Year,
        finish: row.Result,
        roundScores: row["Round scores"],
        toPar: row["To par"],
      }));
      continue;
    }

    if (sectionMatcher(title, /recent results/)) {
      const tableNode = findNextNode(nodes, index, (candidate) => candidate?.__typename === "TableFragment");
      recentResults = objectsFromTable(tableNode).map((row) => ({
        date: row.Date,
        tournamentName: row["Tournament name"],
        result: row.Result,
        roundScores: row["Round scores"],
        toPar: row["To par"],
        fedexPoints: parseFedexPoints(row["FedExCup points"]),
      }));
      continue;
    }

    if (sectionMatcher(title, /recent performances|advanced stats and rankings/)) {
      const listNode = findNextNode(nodes, index, (candidate) => candidate?.__typename === "UnorderedListNode");
      performanceNotes = (listNode?.items || []).map((item) => textFromSegments(item?.segments || [])).filter(Boolean);
      continue;
    }

    if (sectionMatcher(title, /strokes gained rankings/)) {
      const tableNode = findNextNode(nodes, index, (candidate) => candidate?.__typename === "TableFragment");
      strokesGained = parseStrokesGainedTable(tableNode);
    }
  }

  const last4Finishes = recentResults
    .map((row) => parseFinishValue(row.result))
    .filter(Number.isFinite)
    .slice(0, 4);

  return {
    golfer: details?.playerNames?.[0] || details?.players?.[0]?.displayName || null,
    courseHistoryResults: historyRows,
    courseHistoryScore: courseHistoryScore(historyRows),
    recentResults,
    last4Finishes,
    strokesGained,
    performanceNotes,
    sourceRefs: ["PGA TOUR betting profile"],
  };
}

async function fetchProfileHtml(url) {
  return fetchText(url, {
    "User-Agent": "Mozilla/5.0",
    Accept: "text/html,application/xhtml+xml",
  });
}

async function fetchProfileMap(nextTournament) {
  const previewUrl = previewUrlForTournament(nextTournament);
  const html = await fetchProfileHtml(previewUrl);
  const details = extractNewsArticleDetails(html, "Betting profile preview");
  const listNode = (details?.nodes || []).find((node) =>
    node?.__typename === "UnorderedListNode" &&
    (node?.items || []).some((item) => (item?.segments || []).some((segment) => segment?.type === "link" && /betting-profile/.test(segment?.data || "")))
  );

  if (!listNode) {
    throw new Error("Betting profile preview: player profile list not found");
  }

  const entries = new Map();
  for (const item of listNode.items || []) {
    const playerLink = (item?.segments || []).find(
      (segment) => segment?.type === "link" && /\/player\//.test(segment?.data || "")
    );
    const previewLink = (item?.segments || []).find(
      (segment) => segment?.type === "link" && /betting-profile/.test(segment?.data || "")
    );
    const name = String(playerLink?.value || "").trim();
    const url = previewLink?.data;
    const playerId = (item?.segments || []).find((segment) => segment?.__typename === "NewsArticlePlayerTournamentOdds")?.playerId || null;
    if (!name || !url) continue;
    entries.set(normalizeGolferName(name), { name, url, playerId });
  }

  return { previewUrl, entries };
}

async function mapLimit(items, limit, iteratee) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await iteratee(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function findProfileEntry(entries, golfer) {
  const exact = entries.get(normalizeGolferName(golfer));
  if (exact) return exact;

  const wanted = splitNameParts(normalizeGolferName(golfer));
  const candidates = [...entries.entries()]
    .filter(([key]) => {
      const parts = splitNameParts(key);
      return (
        parts.last &&
        parts.last === wanted.last &&
        (
          parts.first.startsWith(wanted.first.slice(0, 3)) ||
          wanted.first.startsWith(parts.first.slice(0, 3))
        )
      );
    })
    .map(([, value]) => value);

  return candidates.length === 1 ? candidates[0] : null;
}

export async function enrichProjectionsWithBettingProfiles(projections, options = {}) {
  const nextTournament = options.nextTournament || null;
  const targetGolfers = Array.isArray(options.golfers) ? options.golfers : [];
  if (!nextTournament?.name || targetGolfers.length === 0) {
    return {
      projections,
      sourceNotes: [],
    };
  }

  const { previewUrl, entries } = await fetchProfileMap(nextTournament);
  const targets = targetGolfers
    .map((golfer) => {
      const match = findProfileEntry(entries, golfer);
      return match ? { golfer, ...match } : null;
    })
    .filter(Boolean);

  const enriched = await mapLimit(targets, 6, async (target) => {
    const html = await fetchProfileHtml(target.url);
    const details = extractNewsArticleDetails(html, target.name);
    return {
      ...parseProfileDetails(details),
      golfer: target.golfer,
    };
  });

  const profileMap = new Map(
    enriched
      .filter((profile) => profile?.golfer)
      .map((profile) => [normalizeGolferName(profile.golfer), profile])
  );

  const merged = projections.map((projection) => {
    const profile = profileMap.get(normalizeGolferName(projection.golfer));
    if (!profile) return projection;
    return {
      ...projection,
      courseHistoryResults: profile.courseHistoryResults,
      courseHistoryScore: profile.courseHistoryScore ?? projection.courseHistoryScore,
      recentResults: profile.recentResults,
      last4Finishes: profile.last4Finishes,
      strokesGained: profile.strokesGained,
      performanceNotes: profile.performanceNotes,
      sourceRefs: [...new Set([...(projection.sourceRefs || []), ...(profile.sourceRefs || [])])],
    };
  });

  return {
    projections: merged,
    sourceNotes: [
      `PGA TOUR betting profile preview: ${previewUrl}`,
      `PGA TOUR betting profiles matched: ${targets.length}/${targetGolfers.length}`,
    ],
  };
}
