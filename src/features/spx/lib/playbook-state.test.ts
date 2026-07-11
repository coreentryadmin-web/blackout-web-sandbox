import test from "node:test";
import assert from "node:assert/strict";
import {
  collectPlaybookInstanceTransitions,
  playbookInstanceId,
  resolvePlaybookLifecycleState,
  verdictLifecycleState,
} from "./playbook-state";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";

test("verdictLifecycleState: triggered > armed > idle", () => {
  const armed: PlaybookMatchVerdict = {
    playbook_id: "PB-01",
    session_window_open: true,
    regime_eligible: true,
    precondition_match: true,
    trigger_fired: false,
    direction: null,
    detail: "",
  };
  assert.equal(verdictLifecycleState(armed), "armed");

  const triggered = { ...armed, trigger_fired: true, direction: "long" as const };
  assert.equal(verdictLifecycleState(triggered), "triggered");

  const idle = { ...armed, regime_eligible: false };
  assert.equal(verdictLifecycleState(idle), "idle");
});

test("collectPlaybookInstanceTransitions: emits on armed transition", () => {
  const session = "2026-07-10";
  const verdicts: PlaybookMatchVerdict[] = [
    {
      playbook_id: "PB-04",
      session_window_open: true,
      regime_eligible: true,
      precondition_match: true,
      trigger_fired: false,
      direction: null,
      detail: "armed",
    },
  ];
  const { transitions } = collectPlaybookInstanceTransitions(session, verdicts, new Map());
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].instance_id, playbookInstanceId(session, "PB-04"));
  assert.equal(transitions[0].from_state, "idle");
  assert.equal(transitions[0].to_state, "armed");
});

test("resolvePlaybookLifecycleState: armed → invalidated when precondition lost", () => {
  const lostPre: PlaybookMatchVerdict = {
    playbook_id: "PB-01",
    session_window_open: true,
    regime_eligible: true,
    precondition_match: false,
    trigger_fired: false,
    direction: null,
    detail: "pre lost",
  };
  assert.equal(resolvePlaybookLifecycleState("armed", lostPre), "invalidated");
});

test("resolvePlaybookLifecycleState: triggered stays latched while firing", () => {
  const firing: PlaybookMatchVerdict = {
    playbook_id: "PB-01",
    session_window_open: true,
    regime_eligible: true,
    precondition_match: true,
    trigger_fired: true,
    direction: "long",
    detail: "fire",
  };
  assert.equal(resolvePlaybookLifecycleState("triggered", firing), "triggered");
});

test("collectPlaybookInstanceTransitions: triggered → invalidated when trigger drops", () => {
  const session = "2026-07-10";
  const prev = new Map([[playbookInstanceId(session, "PB-01"), "triggered" as const]]);
  const verdicts: PlaybookMatchVerdict[] = [
    {
      playbook_id: "PB-01",
      session_window_open: true,
      regime_eligible: true,
      precondition_match: true,
      trigger_fired: false,
      direction: null,
      detail: "trigger lost",
    },
  ];
  const { transitions } = collectPlaybookInstanceTransitions(session, verdicts, prev);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].to_state, "invalidated");
});
