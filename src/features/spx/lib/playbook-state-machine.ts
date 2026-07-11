import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import {
  resolveEpisodeInstance,
  episodeDirectionKey,
  playbookInstanceId,
  type EpisodeDirectionKey,
  type PlaybookInstanceSnapshot,
} from "@/features/spx/lib/playbook-instance-episode";
import {
  applyTriggerExpiryTransitions,
  resolvePlaybookFsmState,
  verdictCandidateState,
  type PlaybookLifecycleState,
} from "@/features/spx/lib/playbook-trade-fsm";

export type { PlaybookLifecycleState };
export {
  isTerminalPlaybookState,
  isPostEntryPlaybookState,
  isPreEntryActiveState,
  isCounterfactualCandidateState,
  playbookTriggerTtlMs,
  verdictCandidateState,
  resolvePlaybookFsmState,
  resolvePreEntryMatcherState,
  resolvePostEntryMatcherState,
  canEngineTransition,
} from "@/features/spx/lib/playbook-trade-fsm";

export type PlaybookFsmTransition = {
  instance_id: string;
  playbook_id: PlaybookId;
  direction: "long" | "short" | null;
  from_state: PlaybookLifecycleState;
  to_state: PlaybookLifecycleState;
  detail: string;
  source: "matcher" | "engine" | "governor" | "expiry";
  spawned?: boolean;
};

export function collectMatcherFsmTransitions(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  snapshots: readonly PlaybookInstanceSnapshot[],
  opts?: { gate_blocked_instance_ids?: ReadonlySet<string>; now_ms?: number }
): { transitions: PlaybookFsmTransition[]; nextByInstance: Map<string, PlaybookLifecycleState> } {
  const nowMs = opts?.now_ms ?? Date.now();
  const prevByInstance = new Map(snapshots.map((s) => [s.instance_id, s.state]));
  const nextByInstance = new Map(prevByInstance);
  const transitions: PlaybookFsmTransition[] = [];
  const workingSnapshots = [...snapshots];

  for (const v of verdicts) {
    const resolved = resolveEpisodeInstance(sessionDate, v, workingSnapshots, nowMs);
    const fromState = resolved.from_state;
    const gateBlocked = opts?.gate_blocked_instance_ids?.has(resolved.instance_id) ?? false;
    const toState = resolvePlaybookFsmState(fromState, v, { gate_blocked: gateBlocked });

    nextByInstance.set(resolved.instance_id, toState);

    if (resolved.spawned && toState !== "idle") {
      workingSnapshots.push({
        instance_id: resolved.instance_id,
        playbook_id: v.playbook_id,
        direction: v.direction,
        state: toState,
        episode_direction: resolved.episode_direction,
        episode_start_ms: nowMs,
        triggered_at_ms: toState === "triggered" || toState === "blocked" ? nowMs : null,
      });
    } else {
      const idx = workingSnapshots.findIndex((s) => s.instance_id === resolved.instance_id);
      if (idx >= 0) {
        const prevTriggered = workingSnapshots[idx].triggered_at_ms;
        workingSnapshots[idx] = {
          ...workingSnapshots[idx],
          state: toState,
          direction: v.direction ?? workingSnapshots[idx].direction,
          triggered_at_ms:
            toState === "triggered" && prevTriggered == null
              ? nowMs
              : toState === "blocked" && prevTriggered == null
                ? nowMs
                : workingSnapshots[idx].triggered_at_ms,
        };
      }
    }

    if (fromState === toState) continue;

    transitions.push({
      instance_id: resolved.instance_id,
      playbook_id: v.playbook_id,
      direction: v.direction,
      from_state: fromState,
      to_state: toState,
      detail: v.detail,
      source: "matcher",
      spawned: resolved.spawned,
    });
  }

  const expiryRows = applyTriggerExpiryTransitions(
    workingSnapshots.map((s) => ({
      instance_id: s.instance_id,
      playbook_id: s.playbook_id,
      direction: s.direction,
      state: nextByInstance.get(s.instance_id) ?? s.state,
      triggered_at_ms: s.triggered_at_ms,
    })),
    nowMs
  );

  for (const exp of expiryRows) {
    const cur = nextByInstance.get(exp.instance_id);
    if (cur !== exp.from_state) continue;
    nextByInstance.set(exp.instance_id, "expired");
    transitions.push({
      instance_id: exp.instance_id,
      playbook_id: exp.playbook_id as PlaybookId,
      direction: exp.direction,
      from_state: exp.from_state,
      to_state: "expired",
      detail: exp.detail,
      source: "expiry",
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
  detail: string,
  episodeStartMs: number
): PlaybookFsmTransition {
  return {
    instance_id: playbookInstanceId(
      sessionDate,
      playbookId,
      episodeDirectionKey(direction),
      episodeStartMs
    ),
    playbook_id: playbookId,
    direction,
    from_state: fromState,
    to_state: toState,
    detail,
    source: "engine",
  };
}
