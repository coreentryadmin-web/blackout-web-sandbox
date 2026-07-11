import test from "node:test";
import assert from "node:assert/strict";
import {
  collectPlaybookInstanceTransitions,
  playbookInstanceId,
  resolvePlaybookLifecycleState,
  verdictLifecycleState,
} from "./playbook-state";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";
import type { PlaybookInstanceSnapshot } from "./playbook-instance-episode";

const NOW = 1_720_000_000_000;

function verdict(overrides: Partial<PlaybookMatchVerdict>): PlaybookMatchVerdict {
  return {
    playbook_id: "PB-01",
    session_window_open: true,
    regime_eligible: true,
    precondition_match: true,
    trigger_fired: false,
    direction: null,
    detail: "",
    ...overrides,
  };
}

test("verdictLifecycleState: triggered > armed > idle", () => {
  const armed = verdict({});
  assert.equal(verdictLifecycleState(armed), "armed");

  const triggered = verdict({ trigger_fired: true, direction: "long" });
  assert.equal(verdictLifecycleState(triggered), "triggered");

  const idle = verdict({ regime_eligible: false });
  assert.equal(verdictLifecycleState(idle), "idle");
});

test("collectPlaybookInstanceTransitions: spawns episode-scoped id on first arm", () => {
  const session = "2026-07-10";
  const { transitions } = collectPlaybookInstanceTransitions(
    session,
    [verdict({ playbook_id: "PB-04", detail: "armed" })],
    [],
    { now_ms: NOW }
  );
  assert.equal(transitions.length, 1);
  assert.equal(
    transitions[0].instance_id,
    playbookInstanceId(session, "PB-04", "undirected", NOW)
  );
  assert.equal(transitions[0].spawned, true);
  assert.equal(transitions[0].from_state, "idle");
  assert.equal(transitions[0].to_state, "armed");
});

test("resolvePlaybookLifecycleState: armed → invalidated when precondition lost", () => {
  assert.equal(
    resolvePlaybookLifecycleState("armed", verdict({ precondition_match: false, detail: "pre lost" })),
    "invalidated"
  );
});

test("collectPlaybookInstanceTransitions: new episode after prior invalidated", () => {
  const session = "2026-07-10";
  const oldId = playbookInstanceId(session, "PB-01", "long", NOW - 60_000);
  const snapshots = [
    {
      instance_id: oldId,
      playbook_id: "PB-01" as const,
      direction: "long" as const,
      state: "invalidated" as const,
      episode_direction: "long" as const,
      episode_start_ms: NOW - 60_000,
      triggered_at_ms: null,
      armed_at_ms: NOW - 60_000,
      invalidated_at_ms: NOW - 30_000,
      trigger_count: 0,
    },
  ];
  const later = NOW;
  const { transitions } = collectPlaybookInstanceTransitions(
    session,
    [verdict({ precondition_match: true, detail: "re-arm" })],
    snapshots,
    { now_ms: later }
  );
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].instance_id, playbookInstanceId(session, "PB-01", "undirected", later));
  assert.equal(transitions[0].spawned, true);
});

test("collectPlaybookInstanceTransitions: opposite direction spawns separate episode", () => {
  const session = "2026-07-10";
  const longId = playbookInstanceId(session, "PB-01", "long", NOW);
  const snapshots = [
    {
      instance_id: longId,
      playbook_id: "PB-01" as const,
      direction: "long" as const,
      state: "armed" as const,
      episode_direction: "long" as const,
      episode_start_ms: NOW,
      triggered_at_ms: null,
      armed_at_ms: NOW,
      invalidated_at_ms: null,
      trigger_count: 0,
    },
  ];
  const shortLater = NOW + 5_000;
  const { transitions } = collectPlaybookInstanceTransitions(
    session,
    [
      verdict({
        trigger_fired: true,
        direction: "short",
        detail: "short trigger",
      }),
    ],
    snapshots,
    { now_ms: shortLater }
  );
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].instance_id, playbookInstanceId(session, "PB-01", "short", shortLater));
  assert.equal(transitions[0].spawned, true);
});
