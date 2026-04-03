import { money } from "./scoring.mjs";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeGolferName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function expectedValueScore(projectedEarnings, salaryCap = 3_500_000) {
  return clamp01(money(projectedEarnings) / salaryCap);
}

function opportunityCostScore(futureValue) {
  return clamp01(money(futureValue) / 2_000_000);
}

function uniquenessScore(projectedDupCount, rivalCount = 3) {
  return clamp01(1 - Math.min(projectedDupCount || 0, rivalCount) / rivalCount);
}

function tierPreservationPenalty(candidate, eventTier) {
  if (eventTier === "major" || eventTier === "signature") return 0;
  const elite = (candidate.historicalStrength || 0) >= 0.85;
  return elite ? 0.25 : 0;
}

function recentFormScore(candidate) {
  const finishes = Array.isArray(candidate.last4Finishes) ? candidate.last4Finishes.filter(Number.isFinite) : [];
  if (finishes.length === 0) return 0.5;
  const avgFinish = finishes.reduce((sum, value) => sum + value, 0) / finishes.length;
  return clamp01(1 - avgFinish / 100);
}

function courseHistoryScore(candidate) {
  return clamp01(candidate.courseHistoryScore ?? 0.5);
}

function strengthScore(candidate) {
  return clamp01(candidate.historicalStrength ?? 0.5);
}

function buildReasonText(candidate, eventTier) {
  const pieces = [];

  if (!candidate.eligible) {
    pieces.push("Not currently confirmed in the upcoming field, so this is not a recommended click-unless-needed option.");
  } else if (!candidate.hasProjectedEarnings) {
    pieces.push("Projection feed is missing this golfer's weekly payout estimate, so the ranking leans on secondary signals.");
  }

  if ((candidate.last4Finishes || []).length) {
    pieces.push(`Recent form: last 4 finishes ${candidate.last4Finishes.join(", ")}.`);
  }

  if (Number.isFinite(candidate.historicalStrength)) {
    pieces.push(`Historical strength index: ${candidate.historicalStrength.toFixed(2)}.`);
  }

  if (Number.isFinite(candidate.courseHistoryScore)) {
    pieces.push(`Course history score: ${candidate.courseHistoryScore.toFixed(2)}.`);
  }

  if ((eventTier === "regular") && (candidate.historicalStrength || 0) > 0.85) {
    pieces.push("Preserves elite major/signature options by lightly penalizing top-tier stars this week.");
  }

  if ((candidate.projectedDupCount || 0) === 0) {
    pieces.push("Leverage edge: projected to be unique against Paul, Dakota, and Mike.");
  }

  return pieces.join(" ");
}

function buildRecentSummary(candidate) {
  const finishes = Array.isArray(candidate.last4Finishes) ? candidate.last4Finishes.filter(Number.isFinite) : [];
  if (finishes.length === 0) return "Recent: Limited recent starts in the last month; form signal is neutral.";
  const avgFinish = finishes.reduce((sum, v) => sum + v, 0) / finishes.length;
  const momentum = avgFinish <= 12 ? "strong momentum" : avgFinish <= 22 ? "steady momentum" : "mixed momentum";
  return `Recent: Last four starts finished ${finishes.join(", ")} with ${momentum} entering this event.`;
}

function buildHistoricalSummary(candidate) {
  const past = Array.isArray(candidate.courseHistoryResults) ? candidate.courseHistoryResults.slice(0, 3) : [];
  if (!past.length) return "Historical: Limited course/event history available; baseline course-fit assumptions applied.";
  const lines = past.map((r) => `${r.year}: ${r.finish}`).join(" | ");
  const quality = (candidate.courseHistoryScore ?? 0.5) >= 0.75 ? "strong" : "solid";
  return `Historical: ${lines}. Overall, historical performance at this event/course has been ${quality}.`;
}

function buildCautionSummary(candidate) {
  if (!candidate.eligible) {
    return "Caution: not confirmed in the next-tournament field. Keep this off the shortlist unless field data changes.";
  }
  if (!candidate.hasProjectedEarnings) {
    return "Caution: projected earnings are missing, so this recommendation carries lower confidence than a normal week.";
  }
  if (!candidate.hasCourseHistory) {
    return "Caution: course/event history is thin, so fit is mostly inferred from broader profile signals.";
  }
  return "Caution: no major data gaps detected, but this remains a blended estimate rather than a guaranteed edge.";
}

function labelConfidence(score) {
  if (score >= 0.78) return "High";
  if (score >= 0.58) return "Medium";
  return "Low";
}

function mergeCandidateData(golfer, projection = {}, playerMeta = {}) {
  const last4Finishes = Array.isArray(projection.last4Finishes) ? projection.last4Finishes.filter(Number.isFinite) : [];
  const courseHistoryResults = Array.isArray(projection.courseHistoryResults) ? projection.courseHistoryResults : [];
  const projectedEarnings = Number(projection.projectedEarnings || 0);
  const projectedDupCount = Number.isFinite(Number(projection.projectedDupCount))
    ? Number(projection.projectedDupCount)
    : 1;
  const futureValue = Number(projection.futureValue || 250000);
  const inNextTournament = Boolean(playerMeta.inNextTournament ?? projection.inNextTournament);

  return {
    ...projection,
    ...playerMeta,
    golfer,
    projectedEarnings,
    projectedDupCount,
    futureValue,
    worldRank: Number.isFinite(Number(projection.worldRank ?? playerMeta.worldRank)) ? Number(projection.worldRank ?? playerMeta.worldRank) : null,
    fedexPoints: Number.isFinite(Number(projection.fedexPoints ?? playerMeta.fedexPoints)) ? Number(projection.fedexPoints ?? playerMeta.fedexPoints) : 0,
    seasonEarnings: Number.isFinite(Number(projection.seasonEarnings ?? playerMeta.seasonEarnings))
      ? Number(projection.seasonEarnings ?? playerMeta.seasonEarnings)
      : 0,
    inNextTournament,
    last4Finishes,
    courseHistoryResults,
    hasProjectedEarnings: projectedEarnings > 0,
    hasCourseHistory: courseHistoryResults.length > 0,
    hasRecentForm: last4Finishes.length > 0,
    eligible: inNextTournament,
  };
}

export function scoreCandidate(candidate, context = {}, weights = {}) {
  const eventTier = context.eventTier || "regular";

  const w = {
    expected: weights.expected ?? 0.35,
    uniqueness: weights.uniqueness ?? 0.15,
    opportunityCost: weights.opportunityCost ?? 0.15,
    recentForm: weights.recentForm ?? 0.2,
    historicalStrength: weights.historicalStrength ?? 0.1,
    courseHistory: weights.courseHistory ?? 0.05,
  };

  const expected = expectedValueScore(candidate.projectedEarnings);
  const uniqueness = uniquenessScore(candidate.projectedDupCount);
  const futureCost = opportunityCostScore(candidate.futureValue);
  const recentForm = recentFormScore(candidate);
  const historicalStrength = strengthScore(candidate);
  const courseHistory = courseHistoryScore(candidate);
  const preservePenalty = tierPreservationPenalty(candidate, eventTier);
  const fieldPenalty = candidate.eligible ? 0 : 0.45;
  const projectionPenalty = candidate.hasProjectedEarnings ? 0 : 0.12;
  const dataPenalty = candidate.hasCourseHistory || candidate.hasRecentForm ? 0 : 0.05;

  const weighted =
    expected * w.expected +
    uniqueness * w.uniqueness +
    (1 - futureCost) * w.opportunityCost +
    recentForm * w.recentForm +
    historicalStrength * w.historicalStrength +
    courseHistory * w.courseHistory;

  const score = Math.max(0, weighted - preservePenalty - fieldPenalty - projectionPenalty - dataPenalty);
  const confidenceScore = clamp01(
    (candidate.eligible ? 0.45 : 0) +
      (candidate.hasProjectedEarnings ? 0.3 : 0) +
      (candidate.hasRecentForm ? 0.15 : 0.05) +
      (candidate.hasCourseHistory ? 0.1 : 0.04)
  );
  const decisionScores = {
    balanced: score,
    expected,
    leverage: clamp01(uniqueness * 0.7 + (candidate.hasProjectedEarnings ? expected * 0.2 : 0.08) + recentForm * 0.1),
    preservation: clamp01((1 - futureCost) * 0.6 + recentForm * 0.15 + historicalStrength * 0.15 + courseHistory * 0.1),
  };
  const flags = [];
  if (!candidate.eligible) flags.push("Out of field");
  if (!candidate.hasProjectedEarnings) flags.push("Missing payout projection");
  if (!candidate.hasCourseHistory) flags.push("Limited course history");
  if ((candidate.projectedDupCount || 0) === 0) flags.push("Projected unique");

  return {
    ...candidate,
    score,
    reasoning: `Reasoning: ${buildReasonText(candidate, eventTier)}`,
    recentSummary: buildRecentSummary(candidate),
    historicalSummary: buildHistoricalSummary(candidate),
    cautionSummary: buildCautionSummary(candidate),
    confidenceScore,
    confidenceLabel: labelConfidence(confidenceScore),
    decisionScores,
    flags,
    rationale: {
      expected,
      uniqueness,
      futureCost,
      recentForm,
      historicalStrength,
      courseHistory,
      preservePenalty,
      fieldPenalty,
      projectionPenalty,
      dataPenalty,
      explanation: buildReasonText(candidate, eventTier),
    },
  };
}

function sortByMetric(candidates, metric, fallbackMetric = "balanced") {
  return [...candidates].sort(
    (a, b) =>
      (b.decisionScores?.[metric] ?? 0) - (a.decisionScores?.[metric] ?? 0) ||
      (b.decisionScores?.[fallbackMetric] ?? 0) - (a.decisionScores?.[fallbackMetric] ?? 0) ||
      b.score - a.score
  );
}

function pickDistinctCandidate(sortedCandidates, usedNames) {
  return sortedCandidates.find((candidate) => !usedNames.has(candidate.golfer)) || sortedCandidates[0] || null;
}

function summarizeWarnings(scored, sourceNotes = [], nextTournamentFieldSize = 0) {
  const eligibleCandidates = scored.filter((candidate) => candidate.eligible);
  const warnings = [];
  if (sourceNotes.some((note) => /No projections returned/i.test(note)) || (eligibleCandidates.length > 0 && eligibleCandidates.every((candidate) => !candidate.hasProjectedEarnings))) {
    warnings.push("Weekly payout projections are missing, so rankings lean on field status, form, history, and preservation signals.");
  }
  if (sourceNotes.some((note) => /reused previous committed season history/i.test(note))) {
    warnings.push("Some historical inputs were reused from prior data because fresh event history was unavailable.");
  }
  if (nextTournamentFieldSize > 0 && scored.filter((candidate) => candidate.eligible).length === 0) {
    warnings.push("No available golfers were matched into the next-tournament field. Check field parsing before trusting the board.");
  }
  if (eligibleCandidates.some((candidate) => !candidate.hasProjectedEarnings)) {
    warnings.push("Candidates without explicit payout projections are marked low-confidence and pushed below better-covered options.");
  }
  return [...new Set(warnings)];
}

export function generateRecommendations(availableGolfers, projections, options = {}) {
  const projectionMap = new Map(projections.map((p) => [normalizeGolferName(p.golfer), p]));
  const playerMetaMap = new Map(
    (options.playerPoolGolfers || []).map((golfer) => [normalizeGolferName(golfer.name || golfer.golfer), golfer])
  );
  const context = { eventTier: options.eventTier || "regular" };

  const scored = availableGolfers
    .map((golfer) => {
      const key = normalizeGolferName(golfer);
      const projection = projectionMap.get(key) || {};
      const playerMeta = playerMetaMap.get(key) || {};
      return scoreCandidate(
        mergeCandidateData(golfer, projection, playerMeta),
        context,
        options.weights
      );
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || (a.worldRank ?? 999) - (b.worldRank ?? 999));

  const rankedPool = scored.some((candidate) => candidate.eligible)
    ? scored.filter((candidate) => candidate.eligible)
    : scored;
  const balanced = rankedPool[0] || null;
  const byExpected = sortByMetric(rankedPool, "expected");
  const byLeverage = sortByMetric(rankedPool, "leverage");
  const byPreservation = sortByMetric(rankedPool, "preservation");
  const usedViewNames = new Set();
  if (balanced) usedViewNames.add(balanced.golfer);
  const expectedView = pickDistinctCandidate(byExpected, usedViewNames);
  if (expectedView) usedViewNames.add(expectedView.golfer);
  const leverageView = pickDistinctCandidate(byLeverage, usedViewNames);
  if (leverageView) usedViewNames.add(leverageView.golfer);
  const preservationView = pickDistinctCandidate(byPreservation, usedViewNames);
  const warnings = summarizeWarnings(scored, options.sourceNotes || [], options.nextTournamentField?.length || 0);

  return {
    generatedAt: new Date().toISOString(),
    primary: balanced,
    alternates: rankedPool.slice(1, 5),
    views: {
      balanced,
      expected: expectedView,
      leverage: leverageView,
      preservation: preservationView,
    },
    summary: {
      totalAvailable: availableGolfers.length,
      eligibleCount: scored.filter((candidate) => candidate.eligible).length,
      projectedCount: scored.filter((candidate) => candidate.hasProjectedEarnings).length,
      nextTournamentFieldCount: options.nextTournamentField?.length || 0,
      confidenceLabel: labelConfidence(
        rankedPool.length ? rankedPool.reduce((sum, candidate) => sum + candidate.confidenceScore, 0) / rankedPool.length : 0
      ),
      warnings,
    },
    scored,
  };
}
