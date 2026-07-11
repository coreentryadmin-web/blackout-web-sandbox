import type { OrBreakMemory } from "@/features/spx/lib/playbook-break-memory";
import { snapshotFromInstanceRow } from "@/features/spx/lib/playbook-instance-episode";
import { pickPrimaryPlaybook } from "@/features/spx/lib/playbook-primary-rank";
import {
  applyPlaybookVerdictGuards,
  nextArmedPollCounts,
  type PlaybookArmedPollCounts,
} from "@/features/spx/lib/playbook-verdict-guard";
import {
  matchPlaybooksShadow,
  type PlaybookMatchVerdict,
  type PlaybookShadowMatchResult,
} from "@/features/spx/lib/playbook-shadow-matcher";
import type { PlaybookLifecycleState } from "@/features/spx/lib/playbook-state";
import type { PlaybookInstanceSnapshot } from "@/features/spx/lib/playbook-instance-episode";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import {
  dbConfigured,
  loadPlaybookArmedPollCounts,
  loadPlaybookInstanceStates,
  loadPlaybookTriggerCountsByPb,
} from "@/lib/db";

export type ResolvedPlaybookMatch = PlaybookShadowMatchResult & {
  raw_verdicts: PlaybookMatchVerdict[];
  instance_snapshots: PlaybookInstanceSnapshot[];
  prev_by_instance: Map<string, PlaybookLifecycleState>;
  armed_poll_counts: PlaybookArmedPollCounts;
  next_armed_poll_counts: Map<string, number>;
  triggers_today_by_pb: Map<string, number>;
};

/** Shadow match + armed-duration guards + session trigger counts (DB-backed when configured). */
export async function resolveGuardedPlaybookMatch(
  sessionDate: string,
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  opts?: { or_break_memory?: OrBreakMemory | null; now?: number }
): Promise<ResolvedPlaybookMatch> {
  const now = opts?.now ?? Date.now();
  const raw = matchPlaybooksShadow(desk, technicals, now, {
    or_break_memory: opts?.or_break_memory ?? null,
  });

  let snapshots: PlaybookInstanceSnapshot[] = [];
  let prevMap = new Map<string, PlaybookLifecycleState>();
  let armedCounts: PlaybookArmedPollCounts = new Map();
  let triggersToday = new Map<string, number>();

  if (dbConfigured()) {
    const states = await loadPlaybookInstanceStates(sessionDate);
    snapshots = states.map(snapshotFromInstanceRow);
    prevMap = new Map(states.map((r) => [r.instance_id, r.state]));
    armedCounts = await loadPlaybookArmedPollCounts(sessionDate);
    triggersToday = await loadPlaybookTriggerCountsByPb(sessionDate);
  }

  const guardedVerdicts = applyPlaybookVerdictGuards(
    sessionDate,
    raw.verdicts,
    snapshots,
    armedCounts,
    now
  );
  const nextArmed = nextArmedPollCounts(sessionDate, raw.verdicts, snapshots, armedCounts, now);

  return {
    verdicts: guardedVerdicts,
    primary_playbook_id: pickPrimaryPlaybook(guardedVerdicts),
    raw_verdicts: raw.verdicts,
    instance_snapshots: snapshots,
    prev_by_instance: prevMap,
    armed_poll_counts: armedCounts,
    next_armed_poll_counts: nextArmed,
    triggers_today_by_pb: triggersToday,
  };
}
