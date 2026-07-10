import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import type { PlaybookFeatureSnapshot } from "@/features/spx/lib/playbook-feature-snapshot";

/** Per-instance lifecycle — maps to ARMED → TRIGGERED → INVALIDATED in FULL-SPEC. */
export type PlaybookLifecycleState = "idle" | "armed" | "triggered" | "invalidated";

export type PlaybookInstanceTransition = {
  instance_id: string;
  playbook_id: PlaybookId;
  direction: "long" | "short" | null;
  from_state: PlaybookLifecycleState;
  to_state: PlaybookLifecycleState;
  detail: string;
};

/** Stable id: one row per playbook per session day. */
export function playbookInstanceId(sessionDate: string, playbookId: PlaybookId): string {
  return `${sessionDate}:${playbookId}`;
}

export function verdictLifecycleState(v: PlaybookMatchVerdict): PlaybookLifecycleState {
  if (!v.regime_eligible || !v.session_window_open) return "idle";
  if (v.trigger_fired) return "triggered";
  if (v.precondition_match) return "armed";
  return "idle";
}

/** Detect state transitions vs prior in-memory/DB snapshot for telemetry persistence. */
export function collectPlaybookInstanceTransitions(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  prevByInstance: ReadonlyMap<string, PlaybookLifecycleState>
): { transitions: PlaybookInstanceTransition[]; nextByInstance: Map<string, PlaybookLifecycleState> } {
  const nextByInstance = new Map(prevByInstance);
  const transitions: PlaybookInstanceTransition[] = [];

  for (const v of verdicts) {
    const instanceId = playbookInstanceId(sessionDate, v.playbook_id);
    const toState = verdictLifecycleState(v);
    const fromState = prevByInstance.get(instanceId) ?? "idle";

    nextByInstance.set(instanceId, toState);

    if (fromState === toState) continue;

    transitions.push({
      instance_id: instanceId,
      playbook_id: v.playbook_id,
      direction: v.direction,
      from_state: fromState,
      to_state: toState,
      detail: v.detail,
    });
  }

  return { transitions, nextByInstance };
}

export type PlaybookInstanceRow = {
  instance_id: string;
  session_date: string;
  playbook_id: PlaybookId;
  direction: "long" | "short" | null;
  state: PlaybookLifecycleState;
  feature_snapshot: PlaybookFeatureSnapshot | null;
  detail: string | null;
};
