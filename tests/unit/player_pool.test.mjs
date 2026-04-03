import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayerPool } from "../../src/lib/player_pool.mjs";

const config = {
  subgroupMembers: ["Andrew", "Paul"],
};

test("buildPlayerPool keeps used golfers unavailable across casing differences", () => {
  const pool = buildPlayerPool(
    {
      events: [
        {
          id: "players-championship",
          tier: "signature",
          totalPurse: 25000000,
          firstPrize: 4500000,
          subgroupResults: [
            { member: "Andrew", pick: "Scottie Scheffler" },
            { member: "Paul", pick: "Collin Morikawa" },
          ],
        },
      ],
      projections: [
        { golfer: "scottie scheffler", worldRank: 1 },
        { golfer: "Rory McIlroy", worldRank: 2 },
      ],
      lastSyncedAt: "2026-03-14T18:00:00.000Z",
    },
    config
  );

  assert.deepEqual(pool.members.Andrew.used, ["Scottie Scheffler"]);
  assert.equal(pool.members.Andrew.available.includes("scottie scheffler"), false);
  assert.equal(pool.members.Andrew.available.includes("Rory McIlroy"), true);
});

test("buildPlayerPool marks only real field entries as next-tournament golfers", () => {
  const pool = buildPlayerPool(
    {
      events: [
        {
          id: "players-championship",
          tier: "signature",
          totalPurse: 25000000,
          firstPrize: 4500000,
          subgroupResults: [],
        },
      ],
      projections: [
        { golfer: "Scottie Scheffler", worldRank: 1, inNextTournament: false },
        { golfer: "Rory McIlroy", worldRank: 2, inNextTournament: false },
        { golfer: "Bryson DeChambeau", worldRank: 3, inNextTournament: true },
      ],
      lastSyncedAt: "2026-03-14T18:00:00.000Z",
    },
    config,
    {
      nextTournamentField: ["Scottie Scheffler", "Rory McIlroy"],
    }
  );

  assert.deepEqual(pool.nextTournamentField, ["Scottie Scheffler", "Rory McIlroy"]);
  assert.equal(pool.golfers.find((golfer) => golfer.name === "Bryson DeChambeau").inNextTournament, false);
});
