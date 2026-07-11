import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import {
  resolveEpisodeInstance,
  type PlaybookInstanceSnapshot,
} from "@/features/spx/lib/playbook-instance-episode";
import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import type { PlaybookLifecycleState } from "@/features/spx/lib/playbook-trade-fsm";
import {
  isPostEntryPlaybookState,
  isTerminalPlaybookState,
} from "@/features/spx/lib/playbook-trade-fsm";
import { temporalContractFor } from "@/features/spx/lib/playbook-registry";
import {
  evaluateRearmCooldown,
  evaluateTemporalTriggerGuard,
} from "@/features/spx/lib/playbook-temporal-contract";

/** Minimum armed polls before a trigger can commit (≈4–6s at 2s play poll). */
export function playbookMinArmedPolls(): number {
  const n = Number(process.env.PLAYBOOK_MIN_ARMED_POLLS ?? "2");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

export type PlaybookArmedPollCounts = ReadonlyMap<string, number>;

function snapshotForEpisode(
  snapshots: readonly PlaybookInstanceSnapshot[],
  instanceId: string,
  playbookId: PlaybookId,
  resolved: ReturnType<typeof resolveEpisodeInstance>,
  nowMs: number
): PlaybookInstanceSnapshot {
  const existing = snapshots.find((s) => s.instance_id === instanceId);
  if (existing) return existing;
  return {
    instance_id: instanceId,
    playbook_id: playbookId,
    direction: null,
    state: resolved.from_state,
    episode_direction: resolved.episode_direction,
    episode_start_ms: nowMs,
    triggered_at_ms: null,
    armed_at_ms: null,
    invalidated_at_ms: null,
    trigger_count: 0,
  };
}

function stripTrigger(v: PlaybookMatchVerdict, reason: string): PlaybookMatchVerdict {
  return {
    ...v,
    trigger_fired: false,
    direction: null,
    detail: `${v.detail} [temporal: ${reason}]`,
  };
}

function stripArm(v: PlaybookMatchVerdict, reason: string): PlaybookMatchVerdict {
  return {
    ...v,
    precondition_match: false,
    trigger_fired: false,
    direction: null,
    detail: `${v.detail} [temporal: ${reason}]`,
  };
}

/** Temporal contracts from typed registry — uses persisted armed_at / terminal timestamps. */
export function applyTemporalVerdictGuards(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  snapshots: readonly PlaybookInstanceSnapshot[],
  nowMs: number = Date.now()
): PlaybookMatchVerdict[] {
  const workingSnapshots = [...snapshots];

  return verdicts.map((v) => {
    const contract = temporalContractFor(v.playbook_id);
    const cooldown = evaluateRearmCooldown(contract, workingSnapshots, v.playbook_id, nowMs);
    if (!cooldown.allow && (v.precondition_match || v.trigger_fired)) {
      return stripArm(v, cooldown.reason);
    }

    const resolved = resolveEpisodeInstance(sessionDate, v, workingSnapshots, nowMs);
    const snap = snapshotForEpisode(
      workingSnapshots,
      resolved.instance_id,
      v.playbook_id,
      resolved,
      nowMs
    );
    snap.state = resolved.from_state;

    if (!v.trigger_fired) return v;

    const guard = evaluateTemporalTriggerGuard({
      contract,
      snapshot: snap,
      prevState: resolved.from_state,
      nowMs,
      precondition_match: v.precondition_match,
    });
    if (!guard.allow) return stripTrigger(v, guard.reason);
    return v;
  });
}

/**
 * Stateful guard — trigger requires prior armed state + minimum armed poll count.
 * Prevents same-tick arm→fire and tick-recomputed false triggers.
 */
export function applyPlaybookVerdictGuards(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  snapshots: readonly PlaybookInstanceSnapshot[],
  armedPollCounts: PlaybookArmedPollCounts,
  nowMs: number = Date.now()
): PlaybookMatchVerdict[] {
  const minArmed = playbookMinArmedPolls();
  const workingSnapshots = [...snapshots];

  const pollGuarded = verdicts.map((v) => {
    const resolved = resolveEpisodeInstance(sessionDate, v, workingSnapshots, nowMs);
    const prev = resolved.from_state;

    if (isTerminalPlaybookState(prev) || isPostEntryPlaybookState(prev)) {
      if (!v.trigger_fired) return v;
      return {
        ...v,
        trigger_fired: false,
        direction: null,
        detail: `${v.detail} [guard: frozen ${prev}]`,
      };
    }

    if (!v.trigger_fired) return v;

    if (!v.precondition_match) {
      return {
        ...v,
        trigger_fired: false,
        direction: null,
        detail: `${v.detail} [guard: precondition_not_met]`,
      };
    }

    const armedPolls = armedPollCounts.get(resolved.instance_id) ?? 0;
    if (armedPolls >= minArmed) return v;

    return {
      ...v,
      trigger_fired: false,
      direction: null,
      detail: `${v.detail} [guard: armed_polls=${armedPolls}, prev=${prev}, need≥${minArmed}]`,
    };
  });

  const guarded = applyTemporalVerdictGuards(sessionDate, pollGuarded, snapshots, nowMs);
  if (verdictGuardAssertEnabled()) {
    assertPlaybookVerdictGuardInvariants(sessionDate, guarded, snapshots, armedPollCounts, nowMs);
  }
  return guarded;
}

/**
 * Defense-in-depth self-consistency check: persisted FSM state + armed polls must allow trigger_fired.
 * Uses durable snapshot rows only (never resolver-derived from_state fallback).
 * Production path re-reads DB in resolveGuardedPlaybookMatch before calling this.
 * Enable with PLAYBOOK_VERDICT_GUARD_ASSERT=1 (dev/staging audits + CI unit tests).
 */
export function assertPlaybookVerdictGuardInvariants(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  snapshots: readonly PlaybookInstanceSnapshot[],
  armedPollCounts: PlaybookArmedPollCounts,
  nowMs: number = Date.now()
): void {
  const minArmed = playbookMinArmedPolls();
  for (const v of verdicts) {
    if (!v.trigger_fired) continue;
    if (!v.precondition_match) {
      throw new Error(`${v.playbook_id}: trigger_fired without precondition_match`);
    }

    const resolved = resolveEpisodeInstance(sessionDate, v, snapshots, nowMs);
    const persisted = snapshots.find((s) => s.instance_id === resolved.instance_id);
    if (!persisted) {
      throw new Error(
        `${v.playbook_id}: trigger_fired without persisted snapshot row (instance=${resolved.instance_id})`
      );
    }
    const persistedState = persisted.state;

    if (persistedState === "idle") {
      throw new Error(
        `${v.playbook_id}: trigger_fired while persisted FSM state is idle (instance=${resolved.instance_id})`
      );
    }
    if (isTerminalPlaybookState(persistedState) || isPostEntryPlaybookState(persistedState)) {
      throw new Error(
        `${v.playbook_id}: trigger_fired in frozen persisted state ${persistedState}`
      );
    }

    const armedPolls = armedPollCounts.get(resolved.instance_id) ?? 0;
    if (armedPolls < minArmed) {
      throw new Error(
        `${v.playbook_id}: trigger_fired with armed_polls=${armedPolls} < ${minArmed} (persisted=${persistedState})`
      );
    }
  }
}

function verdictGuardAssertEnabled(): boolean {
  return process.env.PLAYBOOK_VERDICT_GUARD_ASSERT === "1";
}

/** Increment armed poll counter for instances with precondition_match this tick. */
export function nextArmedPollCounts(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  snapshots: readonly PlaybookInstanceSnapshot[],
  prev: PlaybookArmedPollCounts,
  nowMs: number = Date.now()
): Map<string, number> {
  const next = new Map(prev);
  for (const v of verdicts) {
    if (!v.precondition_match || !v.regime_eligible || !v.session_window_open) continue;
    const resolved = resolveEpisodeInstance(sessionDate, v, snapshots, nowMs);
    if (resolved.spawned || resolved.from_state === "idle") {
      next.set(resolved.instance_id, 1);
      continue;
    }
    next.set(resolved.instance_id, (next.get(resolved.instance_id) ?? 0) + 1);
  }
  return next;
}

export type PlaybookExitProfile = {
  trim_mfe_mult: number;
  trail_window_mult: number;
  thesis_break_mult: number;
  label: string;
};

const DEFAULT_EXIT: PlaybookExitProfile = {
  trim_mfe_mult: 1,
  trail_window_mult: 1,
  thesis_break_mult: 1,
  label: "default",
};

/** Playbook-specific exit tuning when `open_play.playbook_id` is set. */
export function playbookExitProfile(playbookId: string | null | undefined): PlaybookExitProfile {
  if (!playbookId) return DEFAULT_EXIT;

  const profiles: Partial<Record<PlaybookId, PlaybookExitProfile>> = {
    "PB-01": { trim_mfe_mult: 0.9, trail_window_mult: 0.85, thesis_break_mult: 1.1, label: "vwap_reclaim" },
    "PB-02": { trim_mfe_mult: 0.85, trail_window_mult: 0.8, thesis_break_mult: 1.15, label: "vwap_reject" },
    "PB-03": { trim_mfe_mult: 1.1, trail_window_mult: 1.15, thesis_break_mult: 0.95, label: "orb_continuation" },
    "PB-04": { trim_mfe_mult: 0.75, trail_window_mult: 0.7, thesis_break_mult: 1.2, label: "pin_fade_scalp" },
    "PB-11": { trim_mfe_mult: 0.7, trail_window_mult: 0.65, thesis_break_mult: 1.25, label: "chop_scalp" },
    "PB-14": { trim_mfe_mult: 0.95, trail_window_mult: 0.9, thesis_break_mult: 1.05, label: "failed_break" },
  };

  return profiles[playbookId as PlaybookId] ?? DEFAULT_EXIT;
}
