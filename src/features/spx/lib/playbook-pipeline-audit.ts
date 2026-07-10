import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import { playbookDef, type PlaybookId } from "@/features/spx/lib/playbook-registry";

/** Short-side / long-side funnel counts per review §5 (ChatGPT + Claude). */
export type PlaybookPipelineAudit = {
  eligible_long: number;
  eligible_short: number;
  armed_long: number;
  armed_short: number;
  triggered_long: number;
  triggered_short: number;
  blocked_long: number;
  blocked_short: number;
  opened_long: number;
  opened_short: number;
};

function isEligible(v: PlaybookMatchVerdict): boolean {
  return v.regime_eligible && v.session_window_open;
}

function directionBuckets(
  playbookId: PlaybookId,
  direction: PlaybookMatchVerdict["direction"]
): Array<"long" | "short"> {
  if (direction === "long") return ["long"];
  if (direction === "short") return ["short"];
  const def = playbookDef(playbookId);
  if (def.direction === "long") return ["long"];
  if (def.direction === "short") return ["short"];
  return ["long", "short"];
}

function bump(audit: PlaybookPipelineAudit, field: keyof PlaybookPipelineAudit): void {
  audit[field] += 1;
}

/** Aggregate verdicts into directional pipeline counts (shadow telemetry). */
export function computePlaybookPipelineAudit(
  verdicts: readonly PlaybookMatchVerdict[],
  opts?: {
    /** Gate blocks on primary direction — populated when engine evaluated BUY. */
    gate_blocks?: readonly string[];
    primary_direction?: "long" | "short" | null;
    /** Engine committed an open play this tick. */
    opened_direction?: "long" | "short" | null;
  }
): PlaybookPipelineAudit {
  const audit: PlaybookPipelineAudit = {
    eligible_long: 0,
    eligible_short: 0,
    armed_long: 0,
    armed_short: 0,
    triggered_long: 0,
    triggered_short: 0,
    blocked_long: 0,
    blocked_short: 0,
    opened_long: 0,
    opened_short: 0,
  };

  for (const v of verdicts) {
    if (!isEligible(v)) continue;
    const buckets = directionBuckets(v.playbook_id, v.direction);
    for (const side of buckets) {
      bump(audit, side === "long" ? "eligible_long" : "eligible_short");
      if (v.precondition_match) bump(audit, side === "long" ? "armed_long" : "armed_short");
      if (v.trigger_fired && v.direction === side) {
        bump(audit, side === "long" ? "triggered_long" : "triggered_short");
      }
    }
  }

  if (opts?.gate_blocks?.length && opts.primary_direction) {
    const key = opts.primary_direction === "long" ? "blocked_long" : "blocked_short";
    audit[key] += 1;
  }
  if (opts?.opened_direction === "long") audit.opened_long += 1;
  if (opts?.opened_direction === "short") audit.opened_short += 1;

  return audit;
}
