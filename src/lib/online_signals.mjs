import fs from "node:fs/promises";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeGolferName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[åÅ]/g, "a")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

export async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.text();
}

export function mergeSignals(baseProjections, signals) {
  const map = new Map(baseProjections.map((p) => [normalizeGolferName(p.golfer), { ...p }]));

  for (const signal of signals) {
    const name = normalizeGolferName(signal.golfer);
    if (!name) continue;
    const existing = map.get(name) || { golfer: String(signal.golfer || "").trim() || name };

    const last4 = Array.isArray(signal.last4Finishes) ? signal.last4Finishes.map((f) => Number(f)).filter(Number.isFinite) : existing.last4Finishes;

    map.set(name, {
      ...existing,
      projectedEarnings: signal.projectedEarnings ?? existing.projectedEarnings ?? 0,
      projectedDupCount: signal.projectedDupCount ?? existing.projectedDupCount,
      futureValue: signal.futureValue ?? existing.futureValue,
      worldRank: signal.worldRank ?? existing.worldRank ?? 999,
      fedexPoints: signal.fedexPoints ?? existing.fedexPoints ?? 0,
      seasonEarnings: signal.seasonEarnings ?? existing.seasonEarnings ?? 0,
      inNextTournament: signal.inNextTournament ?? existing.inNextTournament ?? false,
      historicalStrength:
        signal.historicalStrength !== undefined
          ? clamp01(signal.historicalStrength)
          : existing.historicalStrength,
      courseHistoryScore:
        signal.courseHistoryScore !== undefined
          ? clamp01(signal.courseHistoryScore)
          : existing.courseHistoryScore,
      last4Finishes: last4,
      golfer: existing.golfer || String(signal.golfer || "").trim() || name,
      sourceRefs: [...new Set([...(existing.sourceRefs || []), ...(signal.sourceRefs || [])])],
    });
  }

  return [...map.values()];
}

function buildUsedByMember(events = [], subgroupMembers = []) {
  const usedByMember = new Map(subgroupMembers.map((member) => [member, new Set()]));
  for (const event of events) {
    for (const row of event?.subgroupResults || []) {
      const member = row?.member;
      if (!usedByMember.has(member)) continue;
      const pick = normalizeGolferName(row?.pick);
      if (pick) usedByMember.get(member).add(pick);
    }
  }
  return usedByMember;
}

function rankScore(worldRank) {
  const rank = numberOr(worldRank, 999);
  if (rank <= 0) return 0;
  return clamp01(1 - Math.log10(rank) / Math.log10(250));
}

function normalizeByMax(value, maxValue) {
  if (!(maxValue > 0)) return 0;
  return clamp01(numberOr(value, 0) / maxValue);
}

function scoreFieldCandidate(candidate, seasonMax, fedexMax) {
  const rank = rankScore(candidate.worldRank);
  const season = normalizeByMax(candidate.seasonEarnings, seasonMax);
  const fedex = normalizeByMax(candidate.fedexPoints, fedexMax);
  const history = clamp01(candidate.historicalStrength ?? 0.4);
  return clamp01(rank * 0.42 + season * 0.23 + fedex * 0.17 + history * 0.18);
}

function projectedShareFromStrength(strength) {
  const s = clamp01(strength);
  return 0.004 + 0.032 * s + 0.06 * (s ** 2) + 0.024 * (s ** 3);
}

function hasExplicitWeeklySource(candidate) {
  return (candidate.sourceRefs || []).some(
    (source) =>
      /projection|odds|sportsbook|rotowire|action network|betmgm|fanduel|draftkings|oddschecker/i.test(String(source)) &&
      !/weekly projection synthesis/i.test(String(source))
  );
}

function futureValueFromStrength(candidate, strength, eventTier) {
  const tierMultiplier = eventTier === "major" ? 1.25 : eventTier === "signature" ? 1.1 : 1;
  const rank = rankScore(candidate.worldRank);
  const preserveBlend = clamp01(strength * 0.65 + rank * 0.35);
  return Math.round(150000 + 1050000 * preserveBlend * tierMultiplier);
}

function estimateDupCount(candidateKey, fieldOrder, rivalCandidatesByMember, usedByMember, me, subgroupMembers) {
  let duplicateExpectation = 0;

  for (const member of subgroupMembers) {
    if (member === me) continue;
    if (usedByMember.get(member)?.has(candidateKey)) continue;

    const rivalField = rivalCandidatesByMember.get(member) || [];
    const rank = rivalField.findIndex((item) => item.key === candidateKey);
    if (rank === -1) continue;

    let probability = 0.02;
    if (rank === 0) probability = 0.34;
    else if (rank === 1) probability = 0.24;
    else if (rank === 2) probability = 0.17;
    else if (rank <= 4) probability = 0.11;
    else if (rank <= 7) probability = 0.06;

    const globalRank = fieldOrder.get(candidateKey);
    const globalRankBoost = Number.isFinite(globalRank) ? Math.max(0, (12 - globalRank) * 0.003) : 0;
    duplicateExpectation += probability + globalRankBoost;
  }

  return Math.min(3, Math.round(duplicateExpectation * 100) / 100);
}

export function synthesizeWeeklySignals(baseProjections, options = {}) {
  const nextTournamentField = Array.isArray(options.nextTournamentField) ? options.nextTournamentField : [];
  const fieldSet = new Set(nextTournamentField.map(normalizeGolferName).filter(Boolean));
  if (!fieldSet.size) {
    return {
      projections: baseProjections.map((candidate) => ({ ...candidate })),
      synthesisSummary: {
        synthesizedCount: 0,
        fieldCandidateCount: 0,
        reason: "No next-tournament field available.",
      },
    };
  }

  const firstPrize = numberOr(options.nextTournament?.firstPrize, 0);
  const totalPurse = numberOr(options.nextTournament?.totalPurse, 0);
  const eventTier = options.nextTournament?.tier || "regular";
  const subgroupMembers = Array.isArray(options.subgroupMembers) ? options.subgroupMembers : [];
  const me = options.me || subgroupMembers[0] || null;
  const usedByMember = options.usedByMember instanceof Map
    ? options.usedByMember
    : buildUsedByMember(options.events || [], subgroupMembers);

  const cloned = baseProjections.map((candidate) => ({ ...candidate }));
  const fieldCandidates = cloned.filter((candidate) => fieldSet.has(normalizeGolferName(candidate.golfer)));

  const seasonMax = Math.max(...fieldCandidates.map((candidate) => numberOr(candidate.seasonEarnings, 0)), 1);
  const fedexMax = Math.max(...fieldCandidates.map((candidate) => numberOr(candidate.fedexPoints, 0)), 1);

  const scoredField = fieldCandidates
    .map((candidate) => {
      const key = normalizeGolferName(candidate.golfer);
      return {
        candidate,
        key,
        strength: scoreFieldCandidate(candidate, seasonMax, fedexMax),
      };
    })
    .sort((a, b) => b.strength - a.strength || numberOr(a.candidate.worldRank, 999) - numberOr(b.candidate.worldRank, 999));

  const fieldOrder = new Map(scoredField.map((entry, index) => [entry.key, index]));
  const rivalCandidatesByMember = new Map(
    subgroupMembers.map((member) => [
      member,
      scoredField.filter((entry) => !usedByMember.get(member)?.has(entry.key)),
    ])
  );

  let synthesizedCount = 0;
  for (const entry of scoredField) {
    const { candidate, key, strength } = entry;
    const explicitWeeklySource = hasExplicitWeeklySource(candidate);
    const projectedEarnings =
      explicitWeeklySource && candidate.projectedEarnings && candidate.projectedEarnings > 0
        ? numberOr(candidate.projectedEarnings, 0)
        : Math.round(Math.max(firstPrize * 0.22 * strength, totalPurse * projectedShareFromStrength(strength)));
    const projectedDupCount =
      explicitWeeklySource && candidate.projectedDupCount !== undefined
        ? numberOr(candidate.projectedDupCount, 1)
        : estimateDupCount(key, fieldOrder, rivalCandidatesByMember, usedByMember, me, subgroupMembers);
    const futureValue =
      explicitWeeklySource && candidate.futureValue && candidate.futureValue > 0
        ? numberOr(candidate.futureValue, 250000)
        : futureValueFromStrength(candidate, strength, eventTier);

    if (!(explicitWeeklySource && candidate.projectedEarnings > 0)) synthesizedCount += 1;

    Object.assign(candidate, {
      projectedEarnings,
      projectedDupCount: Math.round(projectedDupCount * 100) / 100,
      futureValue,
      inNextTournament: true,
      sourceRefs: [...new Set([...(candidate.sourceRefs || []), "Weekly projection synthesis"])],
    });
  }

  for (const candidate of cloned) {
    if (fieldSet.has(normalizeGolferName(candidate.golfer))) continue;
    candidate.inNextTournament = false;
    if (candidate.projectedEarnings === undefined) candidate.projectedEarnings = 0;
    if (candidate.projectedDupCount === undefined) candidate.projectedDupCount = 0;
    if (candidate.futureValue === undefined) candidate.futureValue = futureValueFromStrength(candidate, rankScore(candidate.worldRank), eventTier);
  }

  return {
    projections: cloned,
    synthesisSummary: {
      synthesizedCount,
      fieldCandidateCount: scoredField.length,
      topCandidates: scoredField.slice(0, 5).map((entry) => entry.candidate.golfer),
    },
  };
}

export async function readOnlineSignals(path) {
  const raw = await fs.readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.signals) ? parsed : { signals: [], sourceNotes: [] };
}
