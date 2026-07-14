import test from "node:test";
import assert from "node:assert/strict";
import { playbookInstanceId } from "./playbook-instance-episode";
import { applyTemporalVerdictGuards } from "./playbook-verdict-guard";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";
import {
  DEFAULT_TEMPORAL_CONTRACT,
  evaluateTemporalTriggerGuard,
} from "./playbook-temporal-contract";
import { temporalContractFor } from "@/features/spx/lib/playbook-registry";

const session = "2026-07-10";

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

test("registry exposes temporal contract per playbook", () => {
  const c = temporalContractFor("PB-01");
  assert.ok(c.minimum_arm_duration_ms >= 4_000);
  assert.equal(c.trigger_after_arm_only, true);
  assert.ok(c.max_triggers_per_instance >= 1);
});

test("evaluateTemporalTriggerGuard: blocks trigger without armed_at anchor", () => {
  const now = 1_720_000_300_000;
  const r = evaluateTemporalTriggerGuard({
    contract: DEFAULT_TEMPORAL_CONTRACT,
    snapshot: {
      instance_id: playbookInstanceId(session, "PB-01", "undirected", now),
      playbook_id: "PB-01",
      direction: null,
      state: "idle",
      episode_direction: "undirected",
      episode_start_ms: now,
      triggered_at_ms: null,
      armed_at_ms: null,
      invalidated_at_ms: null,
      trigger_count: 0,
    },
    prevState: "idle",
    nowMs: now,
    precondition_match: true,
  });
  assert.equal(r.allow, false);
});

test("10:01 arm → 10:03 invalidate → 10:06 trigger blocked on new episode", () => {
  const tArm = 1_720_000_060_000;
  const tInvalidate = tArm + 120_000;
  const tTrigger = tArm + 300_000;
  const oldId = playbookInstanceId(session, "PB-01", "undirected", tArm);

  const snapshots = [
    {
      instance_id: oldId,
      playbook_id: "PB-01" as const,
      direction: "long" as const,
      state: "invalidated" as const,
      episode_direction: "undirected" as const,
      episode_start_ms: tArm,
      triggered_at_ms: null,
      armed_at_ms: tArm,
      invalidated_at_ms: tInvalidate,
      trigger_count: 0,
    },
  ];

  const guarded = applyTemporalVerdictGuards(
    session,
    [verdict({ trigger_fired: true, precondition_match: true })],
    snapshots,
    tTrigger
  );

  assert.equal(guarded[0].trigger_fired, false);
  assert.match(guarded[0].detail, /temporal:/);
});

test("trigger allowed after min_arm_duration on same episode", () => {
  const tArm = 1_720_000_000_000;
  const tTrigger = tArm + 8_000;
  const id = playbookInstanceId(session, "PB-01", "long", tArm);

  const r = evaluateTemporalTriggerGuard({
    contract: { ...DEFAULT_TEMPORAL_CONTRACT, minimum_arm_duration_ms: 6_000 },
    snapshot: {
      instance_id: id,
      playbook_id: "PB-01",
      direction: "long",
      state: "armed",
      episode_direction: "long",
      episode_start_ms: tArm,
      triggered_at_ms: null,
      armed_at_ms: tArm,
      invalidated_at_ms: null,
      trigger_count: 0,
    },
    prevState: "armed",
    nowMs: tTrigger,
    precondition_match: true,
  });
  assert.equal(r.allow, true);
});
