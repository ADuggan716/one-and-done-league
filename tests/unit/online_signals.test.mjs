import test from "node:test";
import assert from "node:assert/strict";
import { mergeSignals, synthesizeWeeklySignals } from "../../src/lib/online_signals.mjs";

test("mergeSignals preserves display casing for signal-only golfers", () => {
  const merged = mergeSignals([], [
    {
      golfer: "Scottie Scheffler",
      worldRank: 1,
      fedexPoints: 100,
    },
  ]);

  assert.equal(merged[0].golfer, "Scottie Scheffler");
});

test("synthesizeWeeklySignals fills in modeled weekly values for field golfers", () => {
  const { projections, synthesisSummary } = synthesizeWeeklySignals(
    [
      { golfer: "Scottie Scheffler", worldRank: 1, seasonEarnings: 5000000, fedexPoints: 1200, historicalStrength: 0.9 },
      { golfer: "Justin Thomas", worldRank: 12, seasonEarnings: 900000, fedexPoints: 300, historicalStrength: 0.45 },
      { golfer: "Out Player", worldRank: 8, seasonEarnings: 1500000, fedexPoints: 450, historicalStrength: 0.6 },
    ],
    {
      nextTournamentField: ["Scottie Scheffler", "Justin Thomas"],
      nextTournament: { firstPrize: 1500000, totalPurse: 9000000, tier: "regular" },
      subgroupMembers: ["Andrew", "Paul", "Dakota", "Mike"],
      me: "Andrew",
      events: [
        {
          subgroupResults: [
            { member: "Andrew", pick: "Hideki Matsuyama" },
            { member: "Paul", pick: "Scottie Scheffler" },
            { member: "Dakota", pick: "Jordan Spieth" },
            { member: "Mike", pick: "Tommy Fleetwood" },
          ],
        },
      ],
    }
  );

  const scottie = projections.find((candidate) => candidate.golfer === "Scottie Scheffler");
  const justin = projections.find((candidate) => candidate.golfer === "Justin Thomas");
  const outPlayer = projections.find((candidate) => candidate.golfer === "Out Player");

  assert.ok(scottie.projectedEarnings > justin.projectedEarnings);
  assert.equal(scottie.inNextTournament, true);
  assert.equal(outPlayer.inNextTournament, false);
  assert.ok(scottie.futureValue > justin.futureValue);
  assert.ok(synthesisSummary.synthesizedCount >= 2);
});
