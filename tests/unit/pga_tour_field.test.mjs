import test from "node:test";
import assert from "node:assert/strict";
import { resolveNextTournamentFromSchedule } from "../../src/lib/pga_tour_field.mjs";

test("resolveNextTournamentFromSchedule advances after a completed current event", () => {
  const next = resolveNextTournamentFromSchedule(
    [
      {
        tournamentId: "R2026011",
        name: "THE PLAYERS Championship",
        display: "SHOW",
        status: "IN_PROGRESS",
        displayDate: "Mar 12 - 15",
        purse: "$25,000,000",
        championEarnings: "$4,500,000",
        champions: [{ displayName: "Rory McIlroy" }],
        standings: { value: "750 pts" },
      },
      {
        tournamentId: "R2026475",
        name: "Valspar Championship",
        display: "SHOW",
        status: "UPCOMING",
        displayDate: "Mar 19 - 22",
        purse: "$9,100,000",
        championEarnings: "$1,566,000",
        champions: [{ displayName: "Viktor Hovland" }],
        standings: { value: "500 pts" },
      },
    ],
    "Players Championship",
    { currentEventCompleted: true }
  );

  assert.equal(next.name, "Valspar Championship");
  assert.equal(next.id, "R2026475");
  assert.equal(next.totalPurse, 9100000);
});

test("resolveNextTournamentFromSchedule keeps current event while it is still live", () => {
  const next = resolveNextTournamentFromSchedule(
    [
      {
        tournamentId: "R2026011",
        name: "THE PLAYERS Championship",
        display: "SHOW",
        status: "IN_PROGRESS",
        displayDate: "Mar 12 - 15",
        purse: "$25,000,000",
        championEarnings: "$4,500,000",
        champions: [{ displayName: "Rory McIlroy" }],
        standings: { value: "750 pts" },
      },
      {
        tournamentId: "R2026475",
        name: "Valspar Championship",
        display: "SHOW",
        status: "UPCOMING",
        displayDate: "Mar 19 - 22",
        purse: "$9,100,000",
        championEarnings: "$1,566,000",
        champions: [{ displayName: "Viktor Hovland" }],
        standings: { value: "500 pts" },
      },
    ],
    "Players Championship",
    { currentEventCompleted: false }
  );

  assert.equal(next.name, "THE PLAYERS Championship");
});
