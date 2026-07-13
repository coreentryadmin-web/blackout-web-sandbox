import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTriggerExpiryTransitions,
  isCounterfactualCandidateState,
  isTerminalPlaybookState,
  playbookTriggerTtlMs,
  resolvePlaybookFsmState,
  resolvePostEntryMatcherState,
  resolvePreEntryMatcherState,
} from "./playbook-trade-fsm";
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

test("gate block → blocked, not invalidated or re-armed", () => {
  assert.equal(
    resolvePreEntryMatcherState("triggered", verdict({}), { gate_blocked: true }),
    "blocked"
  );
});

test("blocked + gates clear → triggered again", () => {
  assert.equal(
    resolvePreEntryMatcherState("blocked", verdict({}), { gate_blocked: false }),
    "triggered"
  );
});

test("open + setup lost → exit_pending", () => {
  assert.equal(
    resolvePostEntryMatcherState(
      "open",
      verdict({ trigger_fired: false, precondition_match: false })
    ),
    "exit_pending"
  );
});

test("applyTriggerExpiryTransitions expires stale triggered episodes", () => {
  const ttl = playbookTriggerTtlMs();
  const now = 1_000_000;
  const rows = applyTriggerExpiryTransitions(
    [
      {
        instance_id: "ep-1",
        playbook_id: "PB-01",
        direction: "long",
        state: "triggered",
        triggered_at_ms: now - ttl - 1,
      },
    ],
    now,
    ttl
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].to_state, "expired");
});

test("terminal states include expired and cancelled", () => {
  assert.equal(isTerminalPlaybookState("expired"), true);
  assert.equal(isTerminalPlaybookState("cancelled"), true);
  assert.equal(isCounterfactualCandidateState("blocked"), true);
  assert.equal(isCounterfactualCandidateState("entry_pending"), true);
});

test("resolvePlaybookFsmState: blocked stays blocked while gates still veto", () => {
  assert.equal(
    resolvePlaybookFsmState("blocked", verdict({}), { gate_blocked: true }),
    "blocked"
  );
});
