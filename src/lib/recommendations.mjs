import { money } from "./scoring.mjs";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeGolferName(name) {
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

function expectedValueScore(projectedEarnings, salaryCap = 3_500_000) {
  return clamp01(money(projectedEarnings) / salaryCap);
}

function opportunityCostScore(futureValue) {
  return clamp01(money(futureValue) / 2_000_000);
}

function resolveWeights(eventTier, weights = {}) {
  const base = {
    expected: 0.29,
    uniqueness: 0.14,
    opportunityCost: 0.13,
    recentForm: 0.14,
    historicalStrength: 0.08,
    courseHistory: 0.1,
    strokesGained: 0.08,
    eventHistoryTrend: 0.04,
  };

  if (eventTier === "major") {
    return {
      ...base,
      expected: 0.25,
      uniqueness: 0.12,
      opportunityCost: 0.11,
      recentForm: 0.14,
      historicalStrength: 0.08,
      courseHistory: 0.14,
      strokesGained: 0.09,
      eventHistoryTrend: 0.07,
      ...weights,
    };
  }

  if (eventTier === "signature") {
    return {
      ...base,
      expected: 0.27,
      uniqueness: 0.13,
      opportunityCost: 0.12,
      recentForm: 0.14,
      historicalStrength: 0.08,
      courseHistory: 0.11,
      strokesGained: 0.09,
      eventHistoryTrend: 0.06,
      ...weights,
    };
  }

  return {
    ...base,
    ...weights,
  };
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

function strokesGainedScore(candidate) {
  const total = Number(candidate.strokesGained?.total?.lastFive);
  const approach = Number(candidate.strokesGained?.approach?.lastFive);
  const offTheTee = Number(candidate.strokesGained?.offTheTee?.lastFive);
  const values = [total * 0.55, approach * 0.3, offTheTee * 0.15].filter(Number.isFinite);
  if (!values.length) return 0.5;
  const combined = values.reduce((sum, value) => sum + value, 0);
  return clamp01((combined + 2) / 4);
}

function eventHistoryTrendScore(candidate) {
  const history = Array.isArray(candidate.courseHistoryResults) ? candidate.courseHistoryResults.slice(0, 4) : [];
  if (!history.length) return 0.5;
  const values = history.map((row, index) => {
    const finish = String(row.finish || "").toUpperCase();
    const numeric = finish.match(/T?(\d+)/)?.[1];
    const base = numeric
      ? clamp01(1 - (Number(numeric) - 1) / 60)
      : /MC|WD|DQ/.test(finish)
        ? 0.12
        : 0.35;
    const weight = Math.max(0.5, 1 - index * 0.12);
    return { base, weight };
  });
  const totalWeight = values.reduce((sum, row) => sum + row.weight, 0) || 1;
  return clamp01(values.reduce((sum, row) => sum + row.base * row.weight, 0) / totalWeight);
}

function courseHistoryScore(candidate) {
  return clamp01(candidate.courseHistoryScore ?? 0.5);
}

function strengthScore(candidate) {
  return clamp01(candidate.historicalStrength ?? 0.5);
}

function formatRank(rank) {
  return Number.isFinite(Number(rank)) && Number(rank) > 0 ? `No. ${Number(rank)}` : "unranked";
}

function formatMoneyCompact(value) {
  const amount = money(value);
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function formatSigned(value) {
  if (!Number.isFinite(Number(value))) return null;
  const amount = Number(value);
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(3)}`;
}

function hasDetailedSource(sourceRefs = []) {
  return sourceRefs.some((source) => /recent|history|course|strokes gained|datagolf|rotowire|odds/i.test(String(source)));
}

function isSyntheticRecentFallback(last4Finishes = [], sourceRefs = []) {
  const values = Array.isArray(last4Finishes) ? last4Finishes.filter(Number.isFinite) : [];
  return (
    values.length === 4 &&
    values.join(",") === "35,28,40,22" &&
    !hasDetailedSource(sourceRefs)
  );
}

function isSyntheticCourseFallback(courseHistoryResults = [], courseHistoryScore, sourceRefs = []) {
  return (
    (!Array.isArray(courseHistoryResults) || courseHistoryResults.length === 0) &&
    Number(courseHistoryScore) === 0.5 &&
    !hasDetailedSource(sourceRefs)
  );
}

function buildReasonText(candidate, eventTier) {
  const pieces = [];
  const lead = [];

  if (!candidate.eligible) {
    lead.push("Not currently confirmed in the upcoming field, so this is not a recommended click-unless-needed option.");
  } else if (!candidate.hasProjectedEarnings) {
    lead.push("Projection feed is missing this golfer's weekly payout estimate, so the ranking leans on secondary signals.");
  } else if (Number(candidate.decisionScores?.expected) >= 0.14) {
    lead.push("This is one of the stronger weekly payout profiles on the board.");
  } else if (Number(candidate.decisionScores?.leverage) >= 0.78) {
    lead.push("This creates cleaner separation from the rest of the pool than most top options.");
  } else if (Number(candidate.decisionScores?.preservation) >= 0.66) {
    lead.push("This keeps more future ceiling intact than the typical top-tier click.");
  }

  if ((candidate.last4Finishes || []).length) {
    pieces.push(`Recent form: last 4 finishes ${candidate.last4Finishes.join(", ")}.`);
  } else {
    pieces.push(
      `Season profile: ${formatRank(candidate.worldRank)} OWGR, ${candidate.fedexPoints || 0} FedExCup points, ${formatMoneyCompact(candidate.seasonEarnings)} in season earnings.`
    );
  }

  if (Number.isFinite(candidate.historicalStrength)) {
    pieces.push(`Historical strength index: ${candidate.historicalStrength.toFixed(2)}.`);
  }

  if (Number.isFinite(candidate.strokesGained?.total?.lastFive)) {
    pieces.push(`Last-five SG Total: ${formatSigned(candidate.strokesGained.total.lastFive)}.`);
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

  return [...lead, ...pieces].join(" ");
}

function buildRecentSummary(candidate) {
  const finishes = Array.isArray(candidate.last4Finishes) ? candidate.last4Finishes.filter(Number.isFinite) : [];
  if (finishes.length === 0) {
    return `Recent: Recent-start finish data was not loaded, so this card is leaning on season indicators instead: ${formatRank(candidate.worldRank)} OWGR, ${candidate.fedexPoints || 0} FedExCup points, and ${formatMoneyCompact(candidate.seasonEarnings)} earned this season.`;
  }
  const avgFinish = finishes.reduce((sum, v) => sum + v, 0) / finishes.length;
  const momentum = avgFinish <= 12 ? "strong momentum" : avgFinish <= 22 ? "steady momentum" : "mixed momentum";
  const sgTotal = formatSigned(candidate.strokesGained?.total?.lastFive);
  const sgApproach = formatSigned(candidate.strokesGained?.approach?.lastFive);
  const sgOffTee = formatSigned(candidate.strokesGained?.offTheTee?.lastFive);
  const sgNote = sgTotal
    ? ` Last-five SG Total ${sgTotal}${sgApproach ? `, Approach ${sgApproach}` : ""}${sgOffTee ? `, Off-the-Tee ${sgOffTee}` : ""}.`
    : "";
  return `Recent: Last four starts finished ${finishes.join(", ")} with ${momentum} entering this event.${sgNote}`;
}

function buildHistoricalSummary(candidate) {
  const past = Array.isArray(candidate.courseHistoryResults) ? candidate.courseHistoryResults.slice(0, 3) : [];
  if (!past.length) {
    return `Historical: Detailed event-history rows were not loaded for this golfer. Current fit is inferred from broader profile strength, including ${formatRank(candidate.worldRank)} OWGR and a ${Number(candidate.historicalStrength ?? 0.5).toFixed(2)} historical-strength signal.`;
  }
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
    return "Caution: event-specific history detail is missing, so this relies more on season-long strength, rank, and payout projection than course-specific evidence.";
  }
  return "Caution: no major data gaps detected, but this remains a blended estimate rather than a guaranteed edge.";
}

function labelConfidence(score) {
  if (score >= 0.78) return "High";
  if (score >= 0.58) return "Medium";
  return "Low";
}

function mergeCandidateData(golfer, projection = {}, playerMeta = {}) {
  const sourceRefs = Array.isArray(projection.sourceRefs) ? projection.sourceRefs : [];
  const rawLast4Finishes = Array.isArray(projection.last4Finishes) ? projection.last4Finishes.filter(Number.isFinite) : [];
  const rawCourseHistoryResults = Array.isArray(projection.courseHistoryResults) ? projection.courseHistoryResults : [];
  const last4Finishes = isSyntheticRecentFallback(rawLast4Finishes, sourceRefs) ? [] : rawLast4Finishes;
  const courseHistoryResults = rawCourseHistoryResults;
  const courseHistoryScore = isSyntheticCourseFallback(rawCourseHistoryResults, projection.courseHistoryScore, sourceRefs)
    ? undefined
    : projection.courseHistoryScore;
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
    courseHistoryScore,
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
  const w = resolveWeights(eventTier, weights);

  const expected = expectedValueScore(candidate.projectedEarnings);
  const uniqueness = uniquenessScore(candidate.projectedDupCount);
  const futureCost = opportunityCostScore(candidate.futureValue);
  const recentForm = recentFormScore(candidate);
  const historicalStrength = strengthScore(candidate);
  const courseHistory = courseHistoryScore(candidate);
  const strokesGained = strokesGainedScore(candidate);
  const eventHistoryTrend = eventHistoryTrendScore(candidate);
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
    courseHistory * w.courseHistory +
    strokesGained * w.strokesGained +
    eventHistoryTrend * w.eventHistoryTrend;

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
    leverage: clamp01(uniqueness * 0.66 + (candidate.hasProjectedEarnings ? expected * 0.16 : 0.08) + recentForm * 0.06 + strokesGained * 0.12),
    preservation: clamp01((1 - futureCost) * 0.52 + recentForm * 0.1 + historicalStrength * 0.1 + courseHistory * 0.14 + eventHistoryTrend * 0.06 + strokesGained * 0.08),
  };
  const flags = [];
  if (!candidate.eligible) flags.push("Out of field");
  if (!candidate.hasProjectedEarnings) flags.push("Missing payout projection");
  if (!candidate.hasCourseHistory) flags.push("Course-history detail missing");
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
      strokesGained,
      eventHistoryTrend,
      preservePenalty,
      fieldPenalty,
      projectionPenalty,
      dataPenalty,
      explanation: buildReasonText(candidate, eventTier),
    },
  };
}

function comparisonStrengths(primary, challenger) {
  const strengths = [];
  const push = (label, delta, formatter) => {
    if (!(delta > 0)) return;
    strengths.push({
      label,
      delta,
      detail: formatter(delta),
    });
  };

  push("Projected upside", (primary.decisionScores?.expected ?? 0) - (challenger.decisionScores?.expected ?? 0), (delta) => `${Math.round(delta * 100)} pts more weekly upside`);
  push("Leverage", (primary.decisionScores?.leverage ?? 0) - (challenger.decisionScores?.leverage ?? 0), (delta) => `${Math.round(delta * 100)} pts cleaner leverage`);
  push("Recent form", recentFormScore(primary) - recentFormScore(challenger), (delta) => `${Math.round(delta * 100)} pts better recent-form grade`);
  push("Course history", eventHistoryTrendScore(primary) - eventHistoryTrendScore(challenger), (delta) => `${Math.round(delta * 100)} pts stronger event-history grade`);
  push("Strokes gained", strokesGainedScore(primary) - strokesGainedScore(challenger), (delta) => `${Math.round(delta * 100)} pts stronger SG profile`);
  push("Future preservation", (primary.decisionScores?.preservation ?? 0) - (challenger.decisionScores?.preservation ?? 0), (delta) => `${Math.round(delta * 100)} pts lower-regret spend`);

  return strengths.sort((a, b) => b.delta - a.delta).slice(0, 2);
}

function buildComparisons(primary, rankedPool = []) {
  if (!primary) return [];
  return rankedPool
    .filter((candidate) => candidate.golfer !== primary.golfer)
    .slice(0, 3)
    .map((candidate) => ({
      golfer: candidate.golfer,
      scoreGap: Number(((primary.score ?? 0) - (candidate.score ?? 0)).toFixed(3)),
      strengths: comparisonStrengths(primary, candidate),
    }));
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
    comparisons: buildComparisons(balanced, rankedPool),
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
