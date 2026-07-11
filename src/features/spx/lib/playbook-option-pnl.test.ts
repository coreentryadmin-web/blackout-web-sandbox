import test from "node:test";
import assert from "node:assert/strict";
import { parseOptionPremiumMid, buildGreeksSnapshot, estimateOptionPnl } from "./playbook-option-pnl";

test("parseOptionPremiumMid: extracts first number from range", () => {
  assert.equal(parseOptionPremiumMid("$2.50–$3.00"), 2.5);
  assert.equal(parseOptionPremiumMid(null), null);
});

test("buildGreeksSnapshot: marks synthetic gamma when chain omits it", () => {
  const greeks = buildGreeksSnapshot({
    direction: "long",
    entry_spot: 5400,
    option_mid: 2.5,
    delta: 0.4,
  });
  assert.ok(greeks.synthetic_fields.includes("gamma"));
  assert.ok(greeks.synthetic_fields.includes("iv"));
});

test("estimateOptionPnl: theta loss capped at entry premium", () => {
  const greeks = buildGreeksSnapshot({
    direction: "long",
    entry_spot: 5400,
    option_mid: 2.5,
    delta: 0.4,
    gamma: 0.02,
  });
  const pnl = estimateOptionPnl({
    greeks,
    current_spot: 5400,
    minutes_held: 600,
    round_trip_cost_pts: 0,
  });
  assert.ok(pnl.theta_pnl >= -greeks.entry_premium);
});

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
