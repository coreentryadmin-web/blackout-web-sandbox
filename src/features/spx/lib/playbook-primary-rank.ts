import {
  playbookDef,
  type PlaybookId,
  type PlaybookSetupFamily,
} from "@/features/spx/lib/playbook-registry";
import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";

/**
 * Primary selection — FULL-SPEC §5 order with PB-09 (HELIX) removed.
 * Families (`setup_family`) drive telemetry rollup, not this tie-break list.
 */
export const PLAYBOOK_PRIMARY_PRIORITY: readonly PlaybookId[] = [
  "PB-13",
  "PB-14",
  "PB-03",
  "PB-05",
  "PB-06",
  "PB-04",
  "PB-07",
  "PB-08",
  "PB-01",
  "PB-02",
  "PB-10",
  "PB-11",
  "PB-12",
];

const PRIMARY_INDEX = Object.fromEntries(
  PLAYBOOK_PRIMARY_PRIORITY.map((id, i) => [id, i])
) as Record<PlaybookId, number>;

/** PB-09 evaluates in shadow but cannot be BUY primary (flow modifier). */
export const PLAYBOOK_FLOW_MODIFIER_IDS: ReadonlySet<PlaybookId> = new Set(["PB-09"]);

export function playbookSetupFamily(id: PlaybookId): PlaybookSetupFamily {
  return playbookDef(id).setup_family;
}

function candidateScore(v: PlaybookMatchVerdict): number {
  let score = 0;
  if (v.precondition_match) score += 10;
  if (v.trigger_fired) score += 100;
  if (v.direction != null) score += 5;
  const priority = PRIMARY_INDEX[v.playbook_id];
  if (priority != null) score += Math.max(0, 50 - priority);
  return score;
}

/** Pick primary among triggered + regime-eligible playbooks (PB-09 excluded). */
export function pickPrimaryPlaybook(verdicts: readonly PlaybookMatchVerdict[]): PlaybookId | null {
  const candidates = verdicts.filter(
    (v) =>
      v.trigger_fired &&
      v.regime_eligible &&
      !PLAYBOOK_FLOW_MODIFIER_IDS.has(v.playbook_id)
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].playbook_id;

  candidates.sort((a, b) => {
    const pa = PRIMARY_INDEX[a.playbook_id] ?? 999;
    const pb = PRIMARY_INDEX[b.playbook_id] ?? 999;
    if (pa !== pb) return pa - pb;
    return candidateScore(b) - candidateScore(a);
  });
  return candidates[0].playbook_id;
}
