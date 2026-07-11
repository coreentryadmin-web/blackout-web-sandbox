import test from "node:test";
import assert from "node:assert/strict";
import { buildLiteExecutionSimContract } from "./playbook-option-execution-contract";
import { buildOptionExecutionSim } from "./playbook-option-sim";
import type { OptionTicket } from "./spx-play-options";

const ticket = {
  underlying: "SPXW",
  strike: 5400,
  option_type: "call",
  contract_label: "5400C",
  ticker: "O:SPXW",
  expiration_date: "2026-07-09",
  bid: 2.4,
  ask: 2.6,
  mid: 2.5,
  spread_pct: 8,
  delta: 0.35,
  gamma: 0.02,
  implied_volatility: 0.18,
  volume: 1200,
  open_interest: 1000,
  premium_range: "$2.40–$2.60",
  blocked: false,
  block_reason: null,
} satisfies OptionTicket;

test("buildLiteExecutionSimContract: marks lite_v1 tier and missing full fields", () => {
  const contract = buildLiteExecutionSimContract({
    ticket,
    desk: { price: 5398, polled_at: new Date().toISOString() },
    direction: "long",
    assumed_fill: 2.6,
    exit_assumed_fill: 2.4,
    slippage_pts: 0.1,
    half_spread_pts: 0.1,
    round_trip_cost_pts: 0.2,
  });
  assert.equal(contract.simulator_tier, "lite_v1");
  assert.equal(contract.realism, "research_lite");
  assert.equal(contract.quote.strike, 5400);
  assert.equal(contract.quote.expiration, "2026-07-09");
  assert.ok(contract.missing_for_full_tier.includes("theta") || contract.quote.theta == null);
});

test("buildOptionExecutionSim: attaches contract on happy path", () => {
  const sim = buildOptionExecutionSim(ticket, "long", 5398, {
    price: 5398,
    polled_at: new Date().toISOString(),
  });
  assert.ok(sim);
  assert.equal(sim?.simulator_tier, "lite_v1");
  assert.equal(sim?.contract?.fill_assumption, "adverse_half_spread_plus_bps");
});
