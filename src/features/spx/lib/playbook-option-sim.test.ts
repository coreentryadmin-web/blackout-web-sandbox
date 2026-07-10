import test from "node:test";
import assert from "node:assert/strict";
import { simulateOptionEntry } from "./playbook-option-sim";

test("simulateOptionEntry: long pays adverse fill above mid", () => {
  const result = simulateOptionEntry({
    entry_spot: 5400,
    option_mid: 2.5,
    spread_width: 0.2,
    direction: "long",
  });
  assert.ok(result.assumed_fill > 2.5);
  assert.ok(result.slippage_pts > 0);
});
