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
import {
  findActiveEpisodeInstanceId,
  playbookInstanceId,
  type EpisodeDirectionKey,
  type PlaybookInstanceSnapshot,
  episodeDirectionKey,
  legacyPlaybookInstanceId,
} from "@/features/spx/lib/playbook-instance-episode";

export type { PlaybookLifecycleState, PlaybookFsmTransition };
export type { PlaybookInstanceSnapshot, EpisodeDirectionKey };
export {
  playbookInstanceId,
  legacyPlaybookInstanceId,
  episodeDirectionKey,
  findActiveEpisodeInstanceId,
  parsePlaybookInstanceId,
  resolveEpisodeInstance,
  snapshotFromInstanceRow,
} from "@/features/spx/lib/playbook-instance-episode";

export { verdictCandidateState as verdictLifecycleState };
export { resolvePlaybookFsmState as resolvePlaybookLifecycleState };

export type PlaybookInstanceTransition = {
  instance_id: string;
  playbook_id: PlaybookId;
  direction: "long" | "short" | null;
  from_state: PlaybookLifecycleState;
  to_state: PlaybookLifecycleState;
  detail: string;
  spawned?: boolean;
};

function toInstanceTransition(t: PlaybookFsmTransition): PlaybookInstanceTransition {
  return {
    instance_id: t.instance_id,
    playbook_id: t.playbook_id,
    direction: t.direction,
    from_state: t.from_state,
    to_state: t.to_state,
    detail: t.detail,
    spawned: t.spawned,
  };
}

/** Detect matcher-driven FSM transitions vs prior DB snapshot (episode-scoped). */
export function collectPlaybookInstanceTransitions(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  snapshots: readonly PlaybookInstanceSnapshot[],
  opts?: { gate_blocked_instance_ids?: ReadonlySet<string>; now_ms?: number }
): { transitions: PlaybookInstanceTransition[]; nextByInstance: Map<string, PlaybookLifecycleState> } {
  const { transitions, nextByInstance } = collectMatcherFsmTransitions(
    sessionDate,
    verdicts,
    snapshots,
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
