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

test("assertPlaybookVerdictGuardInvariants: throws when trigger without precondition_match", () => {
  const session = "2026-07-10";
  const bad = verdict("PB-01", { precondition_match: false });
  assert.throws(
    () => assertPlaybookVerdictGuardInvariants(session, [bad], [], new Map(), NOW),
    /precondition_match/
  );
});

test("assertPlaybookVerdictGuardInvariants: throws on idle persisted FSM desync", () => {
  const session = "2026-07-10";
  const armedAt = NOW - 10_000;
  const instanceId = playbookInstanceId(session, "PB-01", "long", armedAt);
  const snapshots = [
    {
      instance_id: instanceId,
      playbook_id: "PB-01",
      direction: "long",
      state: "idle",
      episode_direction: "long",
      episode_start_ms: armedAt,
      triggered_at_ms: null,
      armed_at_ms: null,
      invalidated_at_ms: null,
      trigger_count: 0,
    },
  ];
  const bad = verdict("PB-01", { direction: "long" });
  assert.throws(
    () =>
      assertPlaybookVerdictGuardInvariants(
        session,
        [bad],
        snapshots,
        new Map([[instanceId, 2]]),
        NOW
      ),
    /persisted FSM state is idle/
  );
});

test("assertPlaybookVerdictGuardInvariants: throws when armed polls below minimum", () => {
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
  const bad = verdict("PB-01");
  assert.throws(
    () =>
      assertPlaybookVerdictGuardInvariants(session, [bad], snapshots, new Map([[instanceId, 1]]), NOW),
    /armed_polls=1/
  );
});

test("applyPlaybookVerdictGuards: runs assert when PLAYBOOK_VERDICT_GUARD_ASSERT=1", () => {
  const prev = process.env.PLAYBOOK_VERDICT_GUARD_ASSERT;
  process.env.PLAYBOOK_VERDICT_GUARD_ASSERT = "1";
  try {
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
    const guarded = applyPlaybookVerdictGuards(
      session,
      [verdict("PB-01")],
      snapshots,
      new Map([[instanceId, 2]]),
      NOW
    );
    assert.equal(guarded[0].trigger_fired, true);
  } finally {
    if (prev === undefined) delete process.env.PLAYBOOK_VERDICT_GUARD_ASSERT;
    else process.env.PLAYBOOK_VERDICT_GUARD_ASSERT = prev;
  }
});
