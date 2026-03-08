import test from "node:test";
import assert from "node:assert/strict";
import { applyWeeklyPicks, buildWeeklyComparison, computeSubgroupStandings, computeTeamSummary } from "../../src/lib/scoring.mjs";

test("computeSubgroupStandings handles ties and ranking", () => {
  const members = ["Andrew", "Paul"];
  const events = [
    {
      id: "e1",
      name: "Week 1",
      subgroupResults: [
        { member: "Andrew", earnings: 100 },
        { member: "Paul", earnings: 100 },
      ],
    },
  ];

  const standings = computeSubgroupStandings(members, events);
  assert.equal(standings[0].groupRank, 1);
  assert.equal(standings[1].groupRank, 1);
});

test("applyWeeklyPicks moves golfers from available to used", () => {
  const pool = {
    members: {
      Andrew: { used: ["A"], available: ["B", "C"] },
    },
  };

  const next = applyWeeklyPicks(pool, { Andrew: "B" });
  assert.deepEqual(next.members.Andrew.used, ["A", "B"]);
  assert.deepEqual(next.members.Andrew.available, ["C"]);
});

test("team summary aggregates members", () => {
  const teams = [
    { name: "Young Guns", members: ["Andrew"] },
    { name: "Experienced", members: ["Paul"] },
  ];

  const summary = computeTeamSummary(
    [
      { member: "Andrew", seasonEarnings: 200, weeklyEarnings: 50 },
      { member: "Paul", seasonEarnings: 100, weeklyEarnings: 10 },
    ],
    teams
  );

  assert.equal(summary[0].teamName, "Young Guns");
  assert.equal(summary[0].seasonEarnings, 200);
});

test("buildWeeklyComparison includes purse fields", () => {
  const comparison = buildWeeklyComparison(
    ["Andrew"],
    [
      {
        id: "e1",
        name: "Event",
        tier: "major",
        totalPurse: 1000,
        firstPrize: 300,
        subgroupResults: [{ member: "Andrew", earnings: 10, pick: "X" }],
      },
    ]
  );

  assert.equal(comparison[0].totalPurse, 1000);
  assert.equal(comparison[0].firstPrize, 300);
});
