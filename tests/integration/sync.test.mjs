import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCookieInput,
  normalizeSnapshot,
  shouldActivateCurrentWeekWindow,
  shouldIncludeCurrentEventSnapshot,
  SyncError,
} from "../../src/lib/sync.mjs";

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

test("placeholder current tournament is ignored when it has no live data", () => {
  assert.equal(shouldIncludeCurrentEventSnapshot("Current Tournament", []), false);
  assert.equal(
    shouldIncludeCurrentEventSnapshot("Players Championship", [
      { golfer: "Scottie Scheffler", earnings: 0, seasonEarnings: 100, leagueRank: 5 },
    ]),
    true
  );
});

test("normalizeSnapshot canonicalizes sponsored Houston event naming", () => {
  const normalized = normalizeSnapshot(
    {
      league: { id: "l1", name: "League", totalEntrants: 150, yourRank: 10 },
      events: [
        {
          name: "Houston Open",
          tier: "regular",
          totalPurse: 1000,
          firstPrize: 100,
          picks: [{ member: "Andrew", golfer: "A", earnings: 10, finish: 20 }],
        },
      ],
      nextTournament: { id: "R1", name: "Texas Children's Houston Open", startDate: "Mar 26 - 29" },
      projections: [{ golfer: "A", projectedEarnings: 100 }],
    },
    ["Andrew"]
  );

  assert.equal(normalized.events[0].name, "Texas Children's Houston Open");
  assert.equal(normalized.events[0].id, "texas-children-s-houston-open");
});

test("current week activates at Thursday 8 AM in the tournament start week", () => {
  const nextTournament = {
    name: "Texas Children's Houston Open",
    startDate: "Mar 26 - 29",
  };

  assert.equal(
    shouldActivateCurrentWeekWindow(nextTournament, new Date("2026-03-26T07:59:59-04:00")),
    false
  );
  assert.equal(
    shouldActivateCurrentWeekWindow(nextTournament, new Date("2026-03-26T08:00:00-04:00")),
    true
  );
});

test("normalizeCookieInput accepts a Cookie header", () => {
  const cookie = normalizeCookieInput("Cookie: foo=bar; baz=qux");
  assert.equal(cookie, "foo=bar; baz=qux");
});

test("normalizeCookieInput accepts Netscape cookie export lines", () => {
  const cookie = normalizeCookieInput(".splashsports.com\tTRUE\t/\tFALSE\t0\tfoo\tbar\n.splashsports.com\tTRUE\t/\tFALSE\t0\tbaz\tqux\n");
  assert.equal(cookie, "foo=bar; baz=qux");
});

test("normalizeCookieInput rejects placeholder cookie files", () => {
  assert.throws(
    () => normalizeCookieInput("SESSIONID=replace-with-your-runyourpool-session-cookie"),
    (error) => error instanceof SyncError && error.code === "COOKIE_PLACEHOLDER"
  );
});
