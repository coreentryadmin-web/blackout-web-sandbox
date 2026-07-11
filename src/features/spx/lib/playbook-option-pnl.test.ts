import test from "node:test";
import assert from "node:assert/strict";
import { buildGreeksSnapshot, estimateOptionPnl } from "./playbook-option-pnl";

test("estimateOptionPnl: long gains on spot up", () => {
  const greeks = buildGreeksSnapshot({
    direction: "long",
    entry_spot: 5400,
    option_mid: 2.5,
    delta: 0.4,
  });
  const pnl = estimateOptionPnl({
    greeks,
    current_spot: 5408,
    minutes_held: 5,
    round_trip_cost_pts: 0.15,
  });
  assert.ok(pnl.net_premium_pnl > 0);
});
