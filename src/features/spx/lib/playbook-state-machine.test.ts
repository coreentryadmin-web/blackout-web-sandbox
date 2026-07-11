import test from "node:test";
import assert from "node:assert/strict";
import { collectMatcherFsmTransitions } from "./playbook-state-machine";
import { playbookInstanceId } from "./playbook-instance-episode";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";

const NOW = 1_720_000_000_000;

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

test("collectMatcherFsmTransitions: gate veto → blocked state", () => {
  const session = "2026-07-10";
  const id = playbookInstanceId(session, "PB-01", "long", NOW);
  const { transitions } = collectMatcherFsmTransitions(
    session,
    [verdict({})],
    [
      {
        instance_id: id,
        playbook_id: "PB-01",
        direction: "long",
        state: "triggered",
        episode_direction: "long",
        episode_start_ms: NOW,
        triggered_at_ms: NOW,
      },
    ],
    { gate_blocked_instance_ids: new Set([id]), now_ms: NOW }
  );
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].to_state, "blocked");
});
