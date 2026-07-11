import type { PlaybookId, PlaybookFidelity } from "@/features/spx/lib/playbook-registry";
import type { PlaybookInstanceSnapshot } from "@/features/spx/lib/playbook-instance-episode";
import type { PlaybookLifecycleState } from "@/features/spx/lib/playbook-trade-fsm";
import { isTerminalPlaybookState } from "@/features/spx/lib/playbook-trade-fsm";

/**
 * Typed temporal contract per playbook — enforces sequence using persisted episode
 * timestamps, not tick-recomputed matcher booleans alone.
 */
export type PlaybookTemporalContract = {
  /** Min time in armed (or armed-path) before trigger may commit. */
  minimum_arm_duration_ms: number;
  /** Max time armed without trigger before episode expires. */
  maximum_arm_duration_ms: number;
  /** Trigger must follow a durable arm anchor on this episode. */
  trigger_after_arm_only: boolean;
  /** After precondition flickers off, trigger still valid within this window from armed_at. */
  trigger_grace_period_ms: number;
  /** Min wait after terminal episode before a new arm on same PB. */
  rearm_cooldown_ms: number;
  /** Max trigger commits per episode row. */
  max_triggers_per_instance: number;
};

/** Baseline — aligns with PLAYBOOK_MIN_ARMED_POLLS × ~2s poll. */
export const DEFAULT_TEMPORAL_CONTRACT: PlaybookTemporalContract = {
  minimum_arm_duration_ms: 4_000,
  maximum_arm_duration_ms: 30 * 60_000,
  trigger_after_arm_only: true,
  trigger_grace_period_ms: 0,
  rearm_cooldown_ms: 60_000,
  max_triggers_per_instance: 1,
};

const HIGH_FIDELITY_TEMPORAL: PlaybookTemporalContract = {
  minimum_arm_duration_ms: 6_000,
  maximum_arm_duration_ms: 25 * 60_000,
  trigger_after_arm_only: true,
  trigger_grace_period_ms: 90_000,
  rearm_cooldown_ms: 120_000,
  max_triggers_per_instance: 1,
};

const OPENING_DRIVE_TEMPORAL: PlaybookTemporalContract = {
  minimum_arm_duration_ms: 4_000,
  maximum_arm_duration_ms: 20 * 60_000,
  trigger_after_arm_only: true,
  trigger_grace_period_ms: 45_000,
  rearm_cooldown_ms: 90_000,
  max_triggers_per_instance: 1,
};

const FLOW_EVENT_TEMPORAL: PlaybookTemporalContract = {
  minimum_arm_duration_ms: 2_000,
  maximum_arm_duration_ms: 10 * 60_000,
  trigger_after_arm_only: true,
  trigger_grace_period_ms: 15_000,
  rearm_cooldown_ms: 45_000,
  max_triggers_per_instance: 2,
};

/** Registry defaults by fidelity / playbook class (overridable per row). */
export function defaultTemporalContract(
  fidelity: PlaybookFidelity,
  id: PlaybookId
): PlaybookTemporalContract {
  if (id === "PB-09") return { ...FLOW_EVENT_TEMPORAL };
  if (id === "PB-03" || id === "PB-13" || id === "PB-14") return { ...OPENING_DRIVE_TEMPORAL };
  if (fidelity === "high") return { ...HIGH_FIDELITY_TEMPORAL };
  return { ...DEFAULT_TEMPORAL_CONTRACT };
}

export type TemporalGuardVerdict =
  | { allow: true }
  | { allow: false; reason: string };

const ARM_PATH_STATES: ReadonlySet<PlaybookLifecycleState> = new Set([
  "armed",
  "triggered",
  "blocked",
  "entry_pending",
]);

export function lastTerminalEpisodeMs(
  snapshots: readonly PlaybookInstanceSnapshot[],
  playbookId: PlaybookId
): number | null {
  let best: number | null = null;
  for (const s of snapshots) {
    if (s.playbook_id !== playbookId || !isTerminalPlaybookState(s.state)) continue;
    const terminalMs = s.invalidated_at_ms ?? s.episode_start_ms;
    if (best == null || terminalMs > best) best = terminalMs;
  }
  return best;
}

/** Block new arm/trigger during rearm cooldown after a terminal episode. */
export function evaluateRearmCooldown(
  contract: PlaybookTemporalContract,
  snapshots: readonly PlaybookInstanceSnapshot[],
  playbookId: PlaybookId,
  nowMs: number
): TemporalGuardVerdict {
  const lastTerminal = lastTerminalEpisodeMs(snapshots, playbookId);
  if (lastTerminal == null) return { allow: true };
  const elapsed = nowMs - lastTerminal;
  if (elapsed >= contract.rearm_cooldown_ms) return { allow: true };
  return {
    allow: false,
    reason: `rearm_cooldown ${Math.round(elapsed / 1000)}s < ${Math.round(contract.rearm_cooldown_ms / 1000)}s`,
  };
}

/**
 * Enforce trigger temporal contract against persisted episode anchors.
 * Fixes tick-recomputed false triggers (e.g. arm 10:01, invalidate 10:03, trigger 10:06).
 */
export function evaluateTemporalTriggerGuard(input: {
  contract: PlaybookTemporalContract;
  snapshot: PlaybookInstanceSnapshot;
  prevState: PlaybookLifecycleState;
  nowMs: number;
  precondition_match: boolean;
}): TemporalGuardVerdict {
  const { contract, snapshot, prevState, nowMs, precondition_match } = input;

  if (snapshot.trigger_count >= contract.max_triggers_per_instance) {
    return {
      allow: false,
      reason: `max_triggers_per_instance=${contract.max_triggers_per_instance}`,
    };
  }

  if (contract.trigger_after_arm_only) {
    if (snapshot.armed_at_ms == null && !ARM_PATH_STATES.has(prevState)) {
      return { allow: false, reason: "trigger_after_arm_only: no armed_at anchor" };
    }

    const armedAnchor = snapshot.armed_at_ms ?? snapshot.episode_start_ms;
    const armedElapsed = nowMs - armedAnchor;

    if (armedElapsed < contract.minimum_arm_duration_ms) {
      return {
        allow: false,
        reason: `minimum_arm_duration ${armedElapsed}ms < ${contract.minimum_arm_duration_ms}ms`,
      };
    }

    if (isTerminalPlaybookState(prevState)) {
      return { allow: false, reason: `trigger_after_arm_only: terminal ${prevState}` };
    }

    if (!precondition_match && contract.trigger_grace_period_ms <= 0) {
      if (!ARM_PATH_STATES.has(prevState)) {
        return { allow: false, reason: "precondition lost; grace=0" };
      }
    }

    if (!precondition_match && contract.trigger_grace_period_ms > 0) {
      if (armedElapsed > contract.trigger_grace_period_ms) {
        return {
          allow: false,
          reason: `precondition lost; beyond trigger_grace_period ${contract.trigger_grace_period_ms}ms`,
        };
      }
    }
  }

  return { allow: true };
}

/** Armed too long without trigger — episode should expire. */
export function evaluateMaximumArmDuration(
  contract: PlaybookTemporalContract,
  snapshot: PlaybookInstanceSnapshot,
  nowMs: number
): TemporalGuardVerdict {
  if (snapshot.state !== "armed" || snapshot.armed_at_ms == null) return { allow: true };
  const elapsed = nowMs - snapshot.armed_at_ms;
  if (elapsed <= contract.maximum_arm_duration_ms) return { allow: true };
  return {
    allow: false,
    reason: `maximum_arm_duration ${elapsed}ms > ${contract.maximum_arm_duration_ms}ms`,
  };
}
