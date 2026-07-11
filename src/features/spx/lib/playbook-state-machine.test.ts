import test from "node:test";
import assert from "node:assert/strict";
import {
  collectMatcherFsmTransitions,
  isTerminalPlaybookState,
  resolvePlaybookFsmState,
} from "./playbook-state-machine";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";

function verdict(overrides: Partial<PlaybookMatchVerdict>): PlaybookMatchVerdict {
  return {
    playbook_id: "PB-01",
    session_window_open: true,
    regime_eligible: true,
    precondition_match: true,
    trigger_fired: true,
    direction: "long",
    detail: "test",
    ...overrides,
  };
}

test("resolvePlaybookFsmState: latches triggered across ticks", () => {
  const v = verdict({ trigger_fired: false, precondition_match: true });
  assert.equal(resolvePlaybookFsmState("triggered", v), "invalidated");
  assert.equal(resolvePlaybookFsmState("triggered", verdict({})), "triggered");
});

test("resolvePlaybookFsmState: gate block re-arms triggered", () => {
  assert.equal(
    resolvePlaybookFsmState("triggered", verdict({}), { gate_blocked: true }),
    "armed"
  );
});

test("resolvePlaybookFsmState: frozen post-entry states", () => {
  assert.equal(resolvePlaybookFsmState("open", verdict({})), "open");
  assert.equal(resolvePlaybookFsmState("closed", verdict({})), "closed");
});

test("isTerminalPlaybookState", () => {
  assert.equal(isTerminalPlaybookState("closed"), true);
  assert.equal(isTerminalPlaybookState("armed"), false);
});

test("collectMatcherFsmTransitions: emits open path blocked re-arm", () => {
  const session = "2026-07-10";
  const id = `${session}:PB-01`;
  const { transitions } = collectMatcherFsmTransitions(
    session,
    [verdict({})],
    new Map([[id, "triggered"]]),
    { gate_blocked_instance_ids: new Set([id]) }
  );
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].to_state, "armed");
});
