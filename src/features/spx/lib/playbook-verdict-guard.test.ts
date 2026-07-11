import test from "node:test";
import assert from "node:assert/strict";
import { playbookInstanceId } from "./playbook-instance-episode";
import {
  applyPlaybookVerdictGuards,
  assertPlaybookVerdictGuardInvariants,
  nextArmedPollCounts,
  playbookExitProfile,
} from "./playbook-verdict-guard";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";

const NOW = 1_720_000_000_000;

function verdict(
  id: string,
  overrides: Partial<PlaybookMatchVerdict> = {}
): PlaybookMatchVerdict {
  return {
    playbook_id: id as PlaybookMatchVerdict["playbook_id"],
    session_window_open: true,
    regime_eligible: true,
    precondition_match: true,
    trigger_fired: true,
    direction: "long",
    detail: "test",
    ...overrides,
  };
}

test("applyPlaybookVerdictGuards: blocks same-tick trigger without armed polls", () => {
  const session = "2026-07-10";
  const guarded = applyPlaybookVerdictGuards(session, [verdict("PB-01")], [], new Map(), NOW);
  assert.equal(guarded[0].trigger_fired, false);
  assert.match(guarded[0].detail, /guard:/);
});

test("applyPlaybookVerdictGuards: allows trigger after min armed polls", () => {
  const session = "2026-07-10";
  const armedAt = NOW - 10_000;
  const instanceId = playbookInstanceId(session, "PB-01", "long", armedAt);
  const guarded = applyPlaybookVerdictGuards(
    session,
    [verdict("PB-01")],
    [
      {
        instance_id: instanceId,
        playbook_id: "PB-01",
        direction: "long",
        state: "armed",
        episode_direction: "long",
        episode_start_ms: armedAt,
        triggered_at_ms: null,
        armed_at_ms: armedAt,
        invalidated_at_ms: null,
        trigger_count: 0,
      },
    ],
    new Map([[instanceId, 2]]),
    NOW
  );
  assert.equal(guarded[0].trigger_fired, true);
});

test("nextArmedPollCounts: increments precondition_match instances", () => {
  const session = "2026-07-10";
  const next = nextArmedPollCounts(
    session,
    [verdict("PB-01", { trigger_fired: false, direction: null })],
    [],
    new Map(),
    NOW
  );
  const id = playbookInstanceId(session, "PB-01", "undirected", NOW);
  assert.equal(next.get(id), 1);
});

test("playbookExitProfile: returns default for unknown id", () => {
  const p = playbookExitProfile(null);
  assert.equal(p.label, "default");
  assert.equal(p.trim_mfe_mult, 1);
});

test("assertPlaybookVerdictGuardInvariants: passes after guards strip premature trigger", () => {
  const session = "2026-07-10";
  const armedAt = NOW - 10_000;
  const instanceId = playbookInstanceId(session, "PB-01", "long", armedAt);
  const snapshots = [
    {
      instance_id: instanceId,
      playbook_id: "PB-01",
      direction: "long",
      state: "armed",
      episode_direction: "long",
      episode_start_ms: armedAt,
      triggered_at_ms: null,
      armed_at_ms: armedAt,
      invalidated_at_ms: null,
      trigger_count: 0,
    },
  ];
  const guarded = applyPlaybookVerdictGuards(session, [verdict("PB-01")], snapshots, new Map(), NOW);
  assertPlaybookVerdictGuardInvariants(session, guarded, snapshots, new Map(), NOW);
});
