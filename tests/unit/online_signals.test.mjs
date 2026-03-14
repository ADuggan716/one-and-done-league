import test from "node:test";
import assert from "node:assert/strict";
import { mergeSignals } from "../../src/lib/online_signals.mjs";

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
