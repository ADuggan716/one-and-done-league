import { money } from "./scoring.mjs";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
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

  const weighted =
    expected * w.expected +
    uniqueness * w.uniqueness +
    (1 - futureCost) * w.opportunityCost +
    recentForm * w.recentForm +
    historicalStrength * w.historicalStrength +
    courseHistory * w.courseHistory;

  const score = Math.max(0, weighted - preservePenalty);

  return {
    ...candidate,
    score,
    rationale: {
      expected,
      uniqueness,
      futureCost,
      recentForm,
      historicalStrength,
      courseHistory,
      preservePenalty,
      explanation: buildReasonText(candidate, eventTier),
    },
  };
}

export function generateRecommendations(availableGolfers, projections, options = {}) {
  const projectionMap = new Map(projections.map((p) => [p.golfer, p]));
  const context = { eventTier: options.eventTier || "regular" };

  const scored = availableGolfers
    .map((golfer) => {
      const p = projectionMap.get(golfer) || {
        golfer,
        projectedEarnings: 250000,
        projectedDupCount: 1,
        futureValue: 250000,
        historicalStrength: 0.5,
        courseHistoryScore: 0.5,
        last4Finishes: [35, 28, 40, 22],
      };
      return scoreCandidate({ ...p, golfer }, context, options.weights);
    })
    .sort((a, b) => b.score - a.score);

  return {
    generatedAt: new Date().toISOString(),
    primary: scored[0] || null,
    alternates: scored.slice(1, 5),
    scored,
  };
}
