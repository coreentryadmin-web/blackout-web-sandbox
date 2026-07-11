import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCounterfactualEvalContract,
  counterfactualHorizonSec,
  finalizeCounterfactualEval,
  isCounterfactualWindowActive,
} from "./playbook-counterfactual-contract";

test("buildCounterfactualEvalContract: fixed horizon from trigger time", () => {
  const start = Date.parse("2026-07-09T14:00:00.000Z");
  const contract = buildCounterfactualEvalContract({
    session_date: "2026-07-09",
    direction: "long",
    trigger_price: 6000,
    triggered_at_ms: start,
    hypothetical_stop: 5985,
    hypothetical_target: 6025,
    now_ms: start,
  });
  assert.equal(contract.hypothetical_entry_price, 6000);
  assert.equal(contract.counterfactual_window_start_ms, start);
  assert.equal(contract.counterfactual_horizon_seconds, counterfactualHorizonSec());
  assert.equal(contract.exit_reason_counterfactual, "active");
});

test("isCounterfactualWindowActive: false after horizon elapsed", () => {
  const start = Date.parse("2026-07-09T14:00:00.000Z");
  const contract = buildCounterfactualEvalContract({
    session_date: "2026-07-09",
    direction: "long",
    trigger_price: 6000,
    triggered_at_ms: start,
  });
  const afterHorizon = start + counterfactualHorizonSec() * 1000 + 1000;
  assert.equal(isCounterfactualWindowActive(contract, afterHorizon, "2026-07-09"), false);
});

test("finalizeCounterfactualEval: stamps window end and reason", () => {
  const contract = buildCounterfactualEvalContract({
    session_date: "2026-07-09",
    direction: "short",
    trigger_price: 6000,
    triggered_at_ms: Date.now(),
  });
  const fin = finalizeCounterfactualEval(contract, "setup_invalidated", 12345);
  assert.equal(fin.exit_reason_counterfactual, "setup_invalidated");
  assert.equal(fin.counterfactual_window_end_ms, 12345);
});
