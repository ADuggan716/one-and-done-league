import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSnapshot, SyncError } from "../../src/lib/sync.mjs";

test("normalizeSnapshot success with valid payload", () => {
  const normalized = normalizeSnapshot(
    {
      league: { id: "l1", name: "League", totalEntrants: 150, yourRank: 10 },
      events: [
        {
          id: "e1",
          name: "Event",
          tier: "regular",
          totalPurse: 1000,
          firstPrize: 100,
          picks: [{ member: "Andrew", golfer: "A", earnings: 10, finish: 20 }],
        },
      ],
      projections: [{ golfer: "A", projectedEarnings: 100 }],
    },
    ["Andrew"]
  );

  assert.equal(normalized.events.length, 1);
  assert.equal(normalized.warnings.length, 0);
});

test("normalizeSnapshot with partial data emits warnings", () => {
  const normalized = normalizeSnapshot({}, ["Andrew"]);
  assert.ok(normalized.warnings.length >= 1);
});

test("sync auth error type can be raised and checked", () => {
  const err = new SyncError("expired", "AUTH_EXPIRED");
  assert.equal(err.code, "AUTH_EXPIRED");
});
