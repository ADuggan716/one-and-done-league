import test from "node:test";
import assert from "node:assert/strict";
import { generateRecommendations, scoreCandidate } from "../../src/lib/recommendations.mjs";

test("scoreCandidate reflects weighted components", () => {
  const scored = scoreCandidate(
    {
      golfer: "Player",
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
      { golfer: "A", projectedEarnings: 100 },
      { golfer: "B", projectedEarnings: 200 },
      { golfer: "C", projectedEarnings: 300 },
      { golfer: "D", projectedEarnings: 400 },
      { golfer: "E", projectedEarnings: 500 },
      { golfer: "F", projectedEarnings: 600 },
    ]
  );

  assert.ok(recs.primary);
  assert.equal(recs.alternates.length, 4);
});
