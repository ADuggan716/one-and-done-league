import test from "node:test";
import assert from "node:assert/strict";
import { generateRecommendations, scoreCandidate } from "../../src/lib/recommendations.mjs";

test("scoreCandidate reflects weighted components", () => {
  const scored = scoreCandidate(
    {
      golfer: "Player",
      eligible: true,
      hasProjectedEarnings: true,
      hasRecentForm: true,
      hasCourseHistory: true,
      projectedEarnings: 600000,
      projectedDupCount: 0,
      futureValue: 300000,
      historicalStrength: 0.9,
      courseHistoryScore: 0.8,
      last4Finishes: [4, 8, 9, 12],
    },
    { eventTier: "signature" }
  );

  assert.equal(typeof scored.score, "number");
  assert.equal(scored.rationale.uniqueness, 1);
  assert.ok(scored.rationale.explanation.includes("Recent form"));
});

test("generateRecommendations returns 5 total picks max", () => {
  const recs = generateRecommendations(
    ["A", "B", "C", "D", "E", "F"],
    [
      { golfer: "A", projectedEarnings: 100, last4Finishes: [10], inNextTournament: true },
      { golfer: "B", projectedEarnings: 200, last4Finishes: [9], inNextTournament: true },
      { golfer: "C", projectedEarnings: 300, last4Finishes: [8], inNextTournament: true },
      { golfer: "D", projectedEarnings: 400, last4Finishes: [7], inNextTournament: true },
      { golfer: "E", projectedEarnings: 500, last4Finishes: [6], inNextTournament: true },
      { golfer: "F", projectedEarnings: 600, last4Finishes: [5], inNextTournament: true },
    ],
    {
      nextTournamentField: ["A", "B", "C", "D", "E", "F"],
      playerPoolGolfers: ["A", "B", "C", "D", "E", "F"].map((name) => ({ name, inNextTournament: true })),
    }
  );

  assert.ok(recs.primary);
  assert.equal(recs.alternates.length, 4);
});

test("generateRecommendations prefers confirmed field golfers", () => {
  const recs = generateRecommendations(
    ["Field Player", "Out Player"],
    [
      { golfer: "Field Player", projectedEarnings: 0, last4Finishes: [12, 9, 18, 21] },
      { golfer: "Out Player", projectedEarnings: 900000, last4Finishes: [2, 3, 4, 5] },
    ],
    {
      nextTournamentField: ["Field Player"],
      playerPoolGolfers: [
        { name: "Field Player", inNextTournament: true },
        { name: "Out Player", inNextTournament: false },
      ],
    }
  );

  assert.equal(recs.primary.golfer, "Field Player");
  assert.equal(recs.primary.eligible, true);
  assert.equal(recs.scored.find((candidate) => candidate.golfer === "Out Player").eligible, false);
});

test("generateRecommendations emits warnings when source data is incomplete", () => {
  const recs = generateRecommendations(
    ["A"],
    [{ golfer: "A", projectedEarnings: 0 }],
    {
      nextTournamentField: ["A"],
      playerPoolGolfers: [{ name: "A", inNextTournament: true }],
      sourceNotes: ["No projections returned. Recommendation engine will use fallback estimates."],
    }
  );

  assert.ok(recs.summary.warnings.some((warning) => warning.includes("payout projections are missing")));
  assert.equal(recs.primary.confidenceLabel, "Low");
});
