import test from "node:test";
import assert from "node:assert/strict";
import { buildOptionExecutionSim, simulateOptionEntry } from "./playbook-option-sim";
import type { OptionTicket } from "./spx-play-options";

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

test("buildOptionExecutionSim: attaches model from ticket quotes", () => {
  const ticket = {
    underlying: "SPX",
    strike: 5400,
    option_type: "call",
    contract_label: "5400C",
    ticker: "O:SPXW",
    bid: 2.4,
    ask: 2.6,
    mid: 2.5,
    spread_pct: 8,
    delta: 0.35,
    open_interest: 1000,
    premium_range: "$2.40–$2.60",
    blocked: false,
    block_reason: null,
  } satisfies OptionTicket;

  const sim = buildOptionExecutionSim(ticket, "long", 5398);
  assert.ok(sim);
  assert.equal(sim?.model, "adverse_half_spread_plus_bps");
  assert.ok(sim!.assumed_fill > 2.5);
  assert.ok(sim!.exit_assumed_fill != null);
  assert.ok(sim!.round_trip_cost_pts != null);
  assert.ok(sim!.round_trip_cost_pts! > sim!.slippage_pts);
});
