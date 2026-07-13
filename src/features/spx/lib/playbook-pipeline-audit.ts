import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import {
  playbookDef,
  type PlaybookId,
  type PlaybookSetupFamily,
} from "@/features/spx/lib/playbook-registry";
import {
  playbookHierarchy,
  type PlaybookStructuralSubtype,
} from "@/features/spx/lib/playbook-setup-hierarchy";

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
  family_audit: PlaybookFamilyAudit;
  /** Subtype rollup — finer than family; do not treat family buckets as IID. */
  subtype_audit: PlaybookSubtypeAudit;
};

export type PlaybookFamilyBucket = {
  eligible: number;
  armed: number;
  triggered: number;
};

export type PlaybookFamilyAudit = Record<PlaybookSetupFamily, PlaybookFamilyBucket>;

export type PlaybookSubtypeAudit = Record<PlaybookStructuralSubtype, PlaybookFamilyBucket>;

const EMPTY_FAMILY_BUCKET = (): PlaybookFamilyBucket => ({
  eligible: 0,
  armed: 0,
  triggered: 0,
});

export function emptyPlaybookFamilyAudit(): PlaybookFamilyAudit {
  return {
    trend_continuation: EMPTY_FAMILY_BUCKET(),
    mean_reversion: EMPTY_FAMILY_BUCKET(),
    reversal_failure: EMPTY_FAMILY_BUCKET(),
    flow_event: EMPTY_FAMILY_BUCKET(),
  };
}

const SUBTYPE_KEYS: PlaybookStructuralSubtype[] = [
  "level_rejection",
  "level_reclaim",
  "price_gravitation",
  "range_bound_fade",
  "opening_breakout",
  "wall_breakout",
  "structure_ride",
  "session_momentum",
  "flow_surge",
  "extension_reversal",
  "gap_open_structure",
  "failed_break_reversal",
];

export function emptyPlaybookSubtypeAudit(): PlaybookSubtypeAudit {
  return Object.fromEntries(
    SUBTYPE_KEYS.map((k) => [k, EMPTY_FAMILY_BUCKET()])
  ) as PlaybookSubtypeAudit;
}

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
  if (field === "family_audit") return;
  (audit[field] as number) += 1;
}

function bumpFamily(
  familyAudit: PlaybookFamilyAudit,
  family: PlaybookSetupFamily,
  field: keyof PlaybookFamilyBucket
): void {
  familyAudit[family][field] += 1;
}

function bumpSubtype(
  subtypeAudit: PlaybookSubtypeAudit,
  subtype: PlaybookStructuralSubtype,
  field: keyof PlaybookFamilyBucket
): void {
  subtypeAudit[subtype][field] += 1;
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
    family_audit: emptyPlaybookFamilyAudit(),
    subtype_audit: emptyPlaybookSubtypeAudit(),
  };

  for (const v of verdicts) {
    const family = playbookDef(v.playbook_id).setup_family;
    const subtype = playbookHierarchy(v.playbook_id).structural_subtype;
    if (!isEligible(v)) continue;
    const buckets = directionBuckets(v.playbook_id, v.direction);
    bumpFamily(audit.family_audit, family, "eligible");
    bumpSubtype(audit.subtype_audit, subtype, "eligible");
    if (v.precondition_match) {
      bumpFamily(audit.family_audit, family, "armed");
      bumpSubtype(audit.subtype_audit, subtype, "armed");
    }
    if (v.trigger_fired) {
      bumpFamily(audit.family_audit, family, "triggered");
      bumpSubtype(audit.subtype_audit, subtype, "triggered");
    }
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
