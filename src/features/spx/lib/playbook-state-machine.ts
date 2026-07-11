import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import { playbookInstanceId } from "@/features/spx/lib/playbook-state";

/**
 * Full playbook instance FSM:
 * idle → armed → triggered → open → managing → closed
 * (+ invalidated terminal, triggered → armed on soft gate block)
 */
export type PlaybookLifecycleState =
  | "idle"
  | "armed"
  | "triggered"
  | "invalidated"
  | "open"
  | "managing"
  | "closed";

export type PlaybookFsmTransition = {
  instance_id: string;
  playbook_id: PlaybookId;
  direction: "long" | "short" | null;
  from_state: PlaybookLifecycleState;
  to_state: PlaybookLifecycleState;
  detail: string;
  source: "matcher" | "engine" | "governor";
};

export function isTerminalPlaybookState(state: PlaybookLifecycleState): boolean {
  return state === "closed" || state === "invalidated";
}

export function isPostEntryPlaybookState(state: PlaybookLifecycleState): boolean {
  return state === "open" || state === "managing" || state === "closed";
}

export function verdictCandidateState(v: PlaybookMatchVerdict): PlaybookLifecycleState {
  if (!v.regime_eligible || !v.session_window_open) return "idle";
  if (v.trigger_fired) return "triggered";
  if (v.precondition_match) return "armed";
  return "idle";
}

export type ResolveFsmOpts = {
  /** Primary triggered but gates vetoed — re-arm instead of staying triggered. */
  gate_blocked?: boolean;
};

/**
 * Matcher-driven transition with latch + invalidation.
 * Post-entry states (open/managing) and terminals are frozen — engine owns those edges.
 */
export function resolvePlaybookFsmState(
  prev: PlaybookLifecycleState,
  v: PlaybookMatchVerdict,
  opts?: ResolveFsmOpts
): PlaybookLifecycleState {
  if (isTerminalPlaybookState(prev)) return prev;
  if (prev === "open" || prev === "managing") return prev;

  const naive = verdictCandidateState(v);

  if (prev === "triggered" && opts?.gate_blocked && naive === "triggered") {
    return "armed";
  }

  if (prev === "triggered" && naive === "triggered") return "triggered";

  if (naive === "armed" && prev === "triggered") return "invalidated";

  if (
    naive === "idle" &&
    (prev === "armed" || prev === "triggered") &&
    v.session_window_open &&
    v.regime_eligible
  ) {
    return "invalidated";
  }

  return naive;
}

export function collectMatcherFsmTransitions(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  prevByInstance: ReadonlyMap<string, PlaybookLifecycleState>,
  opts?: { gate_blocked_instance_ids?: ReadonlySet<string> }
): { transitions: PlaybookFsmTransition[]; nextByInstance: Map<string, PlaybookLifecycleState> } {
  const nextByInstance = new Map(prevByInstance);
  const transitions: PlaybookFsmTransition[] = [];

  for (const v of verdicts) {
    const instanceId = playbookInstanceId(sessionDate, v.playbook_id);
    const fromState = prevByInstance.get(instanceId) ?? "idle";
    const gateBlocked = opts?.gate_blocked_instance_ids?.has(instanceId) ?? false;
    const toState = resolvePlaybookFsmState(fromState, v, { gate_blocked: gateBlocked });

    nextByInstance.set(instanceId, toState);

    if (fromState === toState) continue;

    transitions.push({
      instance_id: instanceId,
      playbook_id: v.playbook_id,
      direction: v.direction,
      from_state: fromState,
      to_state: toState,
      detail: v.detail,
      source: "matcher",
    });
  }

  return { transitions, nextByInstance };
}

export function engineFsmTransition(
  sessionDate: string,
  playbookId: PlaybookId,
  fromState: PlaybookLifecycleState,
  toState: PlaybookLifecycleState,
  direction: "long" | "short" | null,
  detail: string
): PlaybookFsmTransition {
  return {
    instance_id: playbookInstanceId(sessionDate, playbookId),
    playbook_id: playbookId,
    direction,
    from_state: fromState,
    to_state: toState,
    detail,
    source: "engine",
  };
}
