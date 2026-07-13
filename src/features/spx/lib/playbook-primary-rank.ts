/**
 * Primary playbook selection — evidence-aware ranking with static priority tie-break.
 *
 * PB-09 (flow modifier) is excluded from primary selection.
 * Static PLAYBOOK_PRIMARY_PRIORITY order applies only when composite scores tie.
 */
import type { PlaybookId } from "./playbook-registry";
import { PLAYBOOK_FLOW_MODIFIER_IDS } from "./playbook-registry";
import {
  buildPrimaryRankContext,
  rankPrimaryCandidates,
  type PrimaryRankBreakdown,
  type PrimaryRankContext,
} from "./playbook-primary-score";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";

export { PLAYBOOK_FLOW_MODIFIER_IDS, buildPrimaryRankContext };

/** Static tie-break order (lower index = higher priority when scores equal). */
export const PLAYBOOK_PRIMARY_PRIORITY: PlaybookId[] = [
  "PB-13",
  "PB-14",
  "PB-03",
  "PB-01",
  "PB-02",
  "PB-04",
  "PB-05",
  "PB-06",
  "PB-07",
  "PB-08",
  "PB-10",
  "PB-11",
  "PB-12",
];

const PRIMARY_PRIORITY_INDEX = Object.fromEntries(
  PLAYBOOK_PRIMARY_PRIORITY.map((id, index) => [id, index]),
) as Readonly<Partial<Record<PlaybookId, number>>>;

export function isPlaybookPrimaryEligible(playbookId: PlaybookId): boolean {
  return !PLAYBOOK_FLOW_MODIFIER_IDS.has(playbookId);
}

export function primaryPriorityIndex(playbookId: PlaybookId): number {
  return PRIMARY_PRIORITY_INDEX[playbookId] ?? 999;
}

export type { PrimaryRankBreakdown, PrimaryRankContext };

export function pickPrimaryPlaybook(
  verdicts: PlaybookMatchVerdict[],
  ctx?: PrimaryRankContext,
): PlaybookId | null {
  return pickPrimaryWithBreakdown(verdicts, ctx).primary;
}

export function pickPrimaryWithBreakdown(
  verdicts: PlaybookMatchVerdict[],
  ctx?: PrimaryRankContext,
): { primary: PlaybookId | null; breakdown: PrimaryRankBreakdown | null } {
  const eligible = verdicts.filter((v) => isPlaybookPrimaryEligible(v.playbook_id));
  if (eligible.length === 0) return { primary: null, breakdown: null };

  const rankCtx = ctx ?? buildPrimaryRankContext({ verdicts: eligible });
  const ranked = rankPrimaryCandidates(eligible, rankCtx, PRIMARY_PRIORITY_INDEX);
  if (ranked.length === 0) return { primary: null, breakdown: null };

  const top = ranked[0]!;
  return { primary: top.playbook_id, breakdown: top };
}
