import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import type { PlaybookFeatureSnapshot } from "@/features/spx/lib/playbook-feature-snapshot";
import {
  collectMatcherFsmTransitions,
  resolvePlaybookFsmState,
  verdictCandidateState,
  type PlaybookFsmTransition,
  type PlaybookLifecycleState,
} from "@/features/spx/lib/playbook-state-machine";

export type { PlaybookLifecycleState, PlaybookFsmTransition };
export { verdictCandidateState as verdictLifecycleState };
export { resolvePlaybookFsmState as resolvePlaybookLifecycleState };

export type PlaybookInstanceTransition = {
  instance_id: string;
  playbook_id: PlaybookId;
  direction: "long" | "short" | null;
  from_state: PlaybookLifecycleState;
  to_state: PlaybookLifecycleState;
  detail: string;
};

/** Stable id today: one row per playbook per session day (P0: episode + direction redesign pending). */
export function playbookInstanceId(sessionDate: string, playbookId: PlaybookId): string {
  return `${sessionDate}:${playbookId}`;
}

function toInstanceTransition(t: PlaybookFsmTransition): PlaybookInstanceTransition {
  return {
    instance_id: t.instance_id,
    playbook_id: t.playbook_id,
    direction: t.direction,
    from_state: t.from_state,
    to_state: t.to_state,
    detail: t.detail,
  };
}

/** Detect matcher-driven FSM transitions vs prior DB snapshot. */
export function collectPlaybookInstanceTransitions(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  prevByInstance: ReadonlyMap<string, PlaybookLifecycleState>,
  opts?: { gate_blocked_instance_ids?: ReadonlySet<string> }
): { transitions: PlaybookInstanceTransition[]; nextByInstance: Map<string, PlaybookLifecycleState> } {
  const { transitions, nextByInstance } = collectMatcherFsmTransitions(
    sessionDate,
    verdicts,
    prevByInstance,
    opts
  );
  return {
    transitions: transitions.map(toInstanceTransition),
    nextByInstance,
  };
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
