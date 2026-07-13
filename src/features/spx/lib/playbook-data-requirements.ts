import type { PlaybookId, PlaybookSetupFamily } from "@/features/spx/lib/playbook-registry";
import type { PlaybookDataQualityFlags } from "@/features/spx/lib/playbook-data-quality";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

/** Feed capabilities a playbook thesis depends on — evaluated generically at gate. */
export type PlaybookDataRequirements = {
  freshDesk: boolean;
  freshHaltFeed: boolean;
  gex: boolean;
  vix: boolean;
  optionQuotes: boolean;
  /** True when playbook thesis depends on true volume-weighted SPX VWAP (not typical-price fallback). */
  volumeWeightedVwap: boolean;
};

export type PlaybookDataRequirementViolation = {
  capability: keyof PlaybookDataRequirements;
  detail: string;
};

export type PlaybookDataSatisfaction = {
  satisfied: boolean;
  violations: PlaybookDataRequirementViolation[];
};

const FAMILY_BY_PB: Record<PlaybookId, PlaybookSetupFamily> = {
  "PB-01": "reversal_failure",
  "PB-02": "mean_reversion",
  "PB-03": "trend_continuation",
  "PB-04": "mean_reversion",
  "PB-05": "trend_continuation",
  "PB-06": "trend_continuation",
  "PB-07": "mean_reversion",
  "PB-08": "trend_continuation",
  "PB-09": "flow_event",
  "PB-10": "trend_continuation",
  "PB-11": "mean_reversion",
  "PB-12": "reversal_failure",
  "PB-13": "reversal_failure",
  "PB-14": "reversal_failure",
};

/** VIX above this blocks all new entries when halt feed is stale (restricted mode). */
export function haltStaleElevatedVixThreshold(): number {
  const raw = process.env.PLAYBOOK_HALT_STALE_VIX_BLOCK;
  const n = raw != null ? Number(raw) : 24;
  return Number.isFinite(n) && n > 0 ? n : 24;
}

function defaultRequirements(
  family: PlaybookSetupFamily,
  id: PlaybookId
): PlaybookDataRequirements {
  const eventFamily =
    family === "trend_continuation" ||
    family === "flow_event" ||
    id === "PB-13" ||
    id === "PB-14";
  const gexStructural =
    id === "PB-04" ||
    id === "PB-05" ||
    id === "PB-06" ||
    id === "PB-07" ||
    id === "PB-12" ||
    family === "trend_continuation";

  return {
    freshDesk: true,
    freshHaltFeed: eventFamily,
    gex: gexStructural,
    vix: id === "PB-03" || id === "PB-08",
    optionQuotes: true,
    volumeWeightedVwap: id === "PB-01" || id === "PB-02",
  };
}

const REQUIREMENTS_BY_PB = Object.fromEntries(
  (Object.keys(FAMILY_BY_PB) as PlaybookId[]).map((id) => [
    id,
    defaultRequirements(FAMILY_BY_PB[id], id),
  ])
) as Record<PlaybookId, PlaybookDataRequirements>;

export function playbookDataRequirements(id: PlaybookId): PlaybookDataRequirements {
  return REQUIREMENTS_BY_PB[id];
}

export function defaultDataRequirementsFor(
  family: PlaybookSetupFamily,
  id: PlaybookId
): PlaybookDataRequirements {
  return defaultRequirements(family, id);
}

/** Low-velocity setups permitted under halt-stale restricted mode. */
export function allowsHaltStaleRestrictedEntry(id: PlaybookId): boolean {
  const family = FAMILY_BY_PB[id];
  const req = REQUIREMENTS_BY_PB[id];
  if (req.freshHaltFeed) return false;
  return family === "mean_reversion" || id === "PB-01";
}

export function evaluatePlaybookDataSatisfaction(
  pbId: PlaybookId,
  flags: PlaybookDataQualityFlags,
  desk?: Pick<SpxDeskPayload, "vix" | "vwap_volume_weighted"> | null,
  opts?: { option_quotes_available?: boolean }
): PlaybookDataSatisfaction {
  const req = REQUIREMENTS_BY_PB[pbId];
  const violations: PlaybookDataRequirementViolation[] = [];

  if (req.volumeWeightedVwap && desk?.vwap_volume_weighted === false) {
    violations.push({
      capability: "volumeWeightedVwap",
      detail: "SPX VWAP not volume-weighted — index bars lack volume (ISSUE-16)",
    });
  }

  if (req.freshDesk && flags.desk_stale) {
    violations.push({
      capability: "freshDesk",
      detail: "desk snapshot stale",
    });
  }
  if (req.gex && flags.gex_missing) {
    violations.push({
      capability: "gex",
      detail: "dealer GEX map missing",
    });
  }
  if (req.vix && (desk?.vix == null || !Number.isFinite(desk.vix))) {
    violations.push({
      capability: "vix",
      detail: "VIX unavailable",
    });
  }
  if (req.optionQuotes && opts?.option_quotes_available === false) {
    violations.push({
      capability: "optionQuotes",
      detail: "option quotes unavailable",
    });
  }

  return { satisfied: violations.length === 0, violations };
}

/** Halt-stale policy: event PBs blocked; elevated VIX blocks all; else restricted low-velocity set. */
export function haltStaleEntryBlocked(
  pbId: PlaybookId,
  flags: PlaybookDataQualityFlags,
  desk?: Pick<SpxDeskPayload, "vix"> | null
): { blocked: boolean; reason: string | null } {
  if (!flags.halt_channel_stale) return { blocked: false, reason: null };

  const req = REQUIREMENTS_BY_PB[pbId];
  if (req.freshHaltFeed) {
    return {
      blocked: true,
      reason: `${pbId} requires fresh halt feed — entry blocked while channel stale`,
    };
  }

  const vix = desk?.vix;
  if (vix != null && vix >= haltStaleElevatedVixThreshold()) {
    return {
      blocked: true,
      reason: `Halt feed stale with elevated VIX (${vix.toFixed(1)}) — all new entries blocked`,
    };
  }

  if (!allowsHaltStaleRestrictedEntry(pbId)) {
    return {
      blocked: true,
      reason: `${pbId} not permitted under halt-stale restricted mode`,
    };
  }

  return { blocked: false, reason: null };
}

export function playbookDataQualityBlockReason(
  pbId: PlaybookId,
  flags: PlaybookDataQualityFlags,
  desk?: Pick<SpxDeskPayload, "vix" | "vwap_volume_weighted"> | null,
  opts?: { option_quotes_available?: boolean }
): string | null {
  const halt = haltStaleEntryBlocked(pbId, flags, desk);
  if (halt.blocked) return halt.reason;

  const sat = evaluatePlaybookDataSatisfaction(pbId, flags, desk, opts);
  if (!sat.satisfied) {
    const caps = sat.violations.map((v) => v.capability).join(", ");
    return `Playbook ${pbId} missing required data capabilities (${caps})`;
  }

  return null;
}
