/**
 * Hierarchical research taxonomy: Family → structural subtype → playbook → parameter version.
 *
 * Families are NOT statistically homogeneous — aggregate at subtype or playbook level for outcomes.
 */
import type { PlaybookId, PlaybookSetupFamily } from "@/features/spx/lib/playbook-registry";

export type PlaybookStructuralSubtype =
  | "level_rejection"
  | "level_reclaim"
  | "price_gravitation"
  | "range_bound_fade"
  | "opening_breakout"
  | "wall_breakout"
  | "structure_ride"
  | "session_momentum"
  | "flow_surge"
  | "extension_reversal"
  | "gap_open_structure"
  | "failed_break_reversal";

export type PlaybookHierarchyNode = {
  setup_family: PlaybookSetupFamily;
  structural_subtype: PlaybookStructuralSubtype;
  /** Immutable config generation for replay — bump when matcher thresholds change materially. */
  parameter_version: string;
};

/** Default parameter generation for all playbooks until per-PB version bumps ship. */
export const PLAYBOOK_PARAMETER_VERSION_DEFAULT = "v1_default";

export const PLAYBOOK_HIERARCHY: Record<PlaybookId, PlaybookHierarchyNode> = {
  "PB-01": {
    setup_family: "reversal_failure",
    structural_subtype: "level_reclaim",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-02": {
    setup_family: "mean_reversion",
    structural_subtype: "level_rejection",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-03": {
    setup_family: "trend_continuation",
    structural_subtype: "opening_breakout",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-04": {
    setup_family: "mean_reversion",
    structural_subtype: "level_rejection",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-05": {
    setup_family: "trend_continuation",
    structural_subtype: "wall_breakout",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-06": {
    setup_family: "trend_continuation",
    structural_subtype: "structure_ride",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-07": {
    setup_family: "mean_reversion",
    structural_subtype: "price_gravitation",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-08": {
    setup_family: "trend_continuation",
    structural_subtype: "session_momentum",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-09": {
    setup_family: "flow_event",
    structural_subtype: "flow_surge",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-10": {
    setup_family: "trend_continuation",
    structural_subtype: "structure_ride",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-11": {
    setup_family: "mean_reversion",
    structural_subtype: "range_bound_fade",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-12": {
    setup_family: "reversal_failure",
    structural_subtype: "extension_reversal",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-13": {
    setup_family: "reversal_failure",
    structural_subtype: "gap_open_structure",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
  "PB-14": {
    setup_family: "reversal_failure",
    structural_subtype: "failed_break_reversal",
    parameter_version: PLAYBOOK_PARAMETER_VERSION_DEFAULT,
  },
};

export function playbookHierarchy(id: PlaybookId): PlaybookHierarchyNode {
  return PLAYBOOK_HIERARCHY[id];
}

export function playbookStructuralSubtype(id: PlaybookId): PlaybookStructuralSubtype {
  return PLAYBOOK_HIERARCHY[id].structural_subtype;
}

/** Human-readable tree for docs / debug panels. */
export function formatPlaybookHierarchyPath(id: PlaybookId): string {
  const h = PLAYBOOK_HIERARCHY[id];
  return `${h.setup_family} → ${h.structural_subtype} → ${id} → ${h.parameter_version}`;
}

export type SubtypeResearchGroup = {
  setup_family: PlaybookSetupFamily;
  structural_subtype: PlaybookStructuralSubtype;
  playbook_ids: PlaybookId[];
};

/** Group playbooks by family + subtype for outcome analysis (never blind family merge). */
export function playbookSubtypeGroups(): SubtypeResearchGroup[] {
  const map = new Map<string, SubtypeResearchGroup>();
  for (const [id, h] of Object.entries(PLAYBOOK_HIERARCHY) as [PlaybookId, PlaybookHierarchyNode][]) {
    const key = `${h.setup_family}:${h.structural_subtype}`;
    const existing = map.get(key);
    if (existing) existing.playbook_ids.push(id);
    else {
      map.set(key, {
        setup_family: h.setup_family,
        structural_subtype: h.structural_subtype,
        playbook_ids: [id],
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    `${a.setup_family}:${a.structural_subtype}`.localeCompare(`${b.setup_family}:${b.structural_subtype}`)
  );
}
