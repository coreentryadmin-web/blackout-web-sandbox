import {
  playbookDef,
  type PlaybookFidelity,
  type PlaybookId,
  type PlaybookSetupFamily,
} from "@/features/spx/lib/playbook-registry";
import {
  isDegradedForLivePlaybook,
  liveDataQualityMode,
  playbookDataQualityFlags,
  type LiveDataQualityMode,
  type PlaybookDataQualityFlags,
} from "@/features/spx/lib/playbook-data-quality";
import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { playbookMinArmedPolls } from "@/features/spx/lib/playbook-verdict-guard";

/** Context for evidence-aware primary ranking — no raw win-rate weights. */
export type PrimaryRankContext = {
  desk?: SpxDeskPayload | null;
  data_quality_flags?: PlaybookDataQualityFlags;
  data_quality_mode?: LiveDataQualityMode;
  /** Armed polls on active episode for this PB (proxy for trigger freshness). */
  armed_polls_by_pb?: ReadonlyMap<PlaybookId, number>;
  option_spread_pct?: number | null;
  option_mid?: number | null;
  now_ms?: number;
};

export type PrimaryRankBreakdown = {
  playbook_id: PlaybookId;
  total: number;
  setup_completeness: number;
  regime_compatibility: number;
  fidelity_tier: number;
  trigger_freshness: number;
  invalidation_buffer: number;
  target_space: number;
  option_cost: number;
  data_quality: number;
  family_conflict_penalty: number;
  oos_evidence_confidence: number;
  static_priority_tiebreak: number;
};

/** OOS research priors by family — not in-sample win rate. */
const OOS_FAMILY_PRIOR: Record<PlaybookSetupFamily, number> = {
  reversal_failure: 6,
  trend_continuation: 5,
  mean_reversion: 4,
  flow_event: 1,
};

const FIDELITY_SCORE: Record<PlaybookFidelity, number> = {
  high: 12,
  mvp: 4,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function setupCompletenessScore(v: PlaybookMatchVerdict): number {
  let s = 0;
  if (v.precondition_match) s += 8;
  if (v.trigger_fired) s += 14;
  if (v.direction != null) s += 3;
  return s;
}

function regimeCompatibilityScore(v: PlaybookMatchVerdict): number {
  let s = 0;
  if (v.regime_eligible) s += 12;
  if (v.session_window_open) s += 3;
  return s;
}

function triggerFreshnessScore(v: PlaybookMatchVerdict, ctx: PrimaryRankContext): number {
  const polls = ctx.armed_polls_by_pb?.get(v.playbook_id) ?? playbookMinArmedPolls();
  const min = playbookMinArmedPolls();
  if (polls < min) return 2;
  if (polls <= min + 2) return 10;
  if (polls <= min + 6) return 7;
  return 4;
}

function invalidationBufferScore(v: PlaybookMatchVerdict, desk: SpxDeskPayload | null | undefined): number {
  const price = desk?.price;
  const vwap = desk?.vwap;
  if (price == null || vwap == null || v.direction == null) return 5;
  const dist = Math.abs(price - vwap);
  const dirAligned =
    v.direction === "long" ? price >= vwap : price <= vwap;
  if (!dirAligned) return 1;
  return clamp(3 + dist / 2, 3, 10);
}

function targetSpaceScore(v: PlaybookMatchVerdict, desk: SpxDeskPayload | null | undefined): number {
  const price = desk?.price;
  const walls = desk?.gex_walls ?? [];
  if (price == null || !walls.length || v.direction == null) return 5;
  const ahead = walls
    .map((w) => w.strike)
    .filter((strike) =>
      v.direction === "long" ? strike > price : strike < price
    )
    .map((strike) => Math.abs(strike - price));
  if (!ahead.length) return 8;
  const nearest = Math.min(...ahead);
  return clamp(nearest / 3, 2, 10);
}

function optionCostScore(ctx: PrimaryRankContext): number {
  const spread = ctx.option_spread_pct;
  if (spread == null) return 5;
  if (spread <= 8) return 8;
  if (spread <= 15) return 5;
  if (spread <= 25) return 2;
  return 0;
}

function dataQualityScore(
  pbId: PlaybookId,
  ctx: PrimaryRankContext
): number {
  const flags = ctx.data_quality_flags;
  const mode = ctx.data_quality_mode ?? (flags ? liveDataQualityMode(flags) : "normal");
  if (mode === "severe") return 0;
  if (mode === "degraded" && flags && isDegradedForLivePlaybook(pbId, flags)) return 2;
  if (mode === "degraded") return 5;
  return 10;
}

/** Structural OOS confidence — fidelity + family prior, not historical win rate. */
function oosEvidenceConfidence(pbId: PlaybookId): number {
  const def = playbookDef(pbId);
  const familyPrior = OOS_FAMILY_PRIOR[def.setup_family];
  const fidelityBoost = def.fidelity === "high" ? 2 : 0;
  return clamp(familyPrior + fidelityBoost, 0, 10);
}

function scoreCandidate(
  v: PlaybookMatchVerdict,
  ctx: PrimaryRankContext
): Omit<PrimaryRankBreakdown, "family_conflict_penalty" | "static_priority_tiebreak" | "total"> {
  return {
    playbook_id: v.playbook_id,
    setup_completeness: setupCompletenessScore(v),
    regime_compatibility: regimeCompatibilityScore(v),
    fidelity_tier: FIDELITY_SCORE[playbookDef(v.playbook_id).fidelity],
    trigger_freshness: triggerFreshnessScore(v, ctx),
    invalidation_buffer: invalidationBufferScore(v, ctx.desk),
    target_space: targetSpaceScore(v, ctx.desk),
    option_cost: optionCostScore(ctx),
    data_quality: dataQualityScore(v.playbook_id, ctx),
    oos_evidence_confidence: oosEvidenceConfidence(v.playbook_id),
  };
}

function applyFamilyConflictPenalties(
  rows: PrimaryRankBreakdown[]
): PrimaryRankBreakdown[] {
  const byFamily = new Map<PlaybookSetupFamily, PrimaryRankBreakdown[]>();
  for (const row of rows) {
    const fam = playbookDef(row.playbook_id).setup_family;
    const list = byFamily.get(fam) ?? [];
    list.push(row);
    byFamily.set(fam, list);
  }

  return rows.map((row) => {
    const fam = playbookDef(row.playbook_id).setup_family;
    const peers = byFamily.get(fam) ?? [];
    if (peers.length <= 1) return row;
    const prePenaltyTotal =
      row.setup_completeness +
      row.regime_compatibility +
      row.fidelity_tier +
      row.trigger_freshness +
      row.invalidation_buffer +
      row.target_space +
      row.option_cost +
      row.data_quality +
      row.oos_evidence_confidence;
    const best = Math.max(
      ...peers.map(
        (p) =>
          p.setup_completeness +
          p.regime_compatibility +
          p.fidelity_tier +
          p.trigger_freshness +
          p.invalidation_buffer +
          p.target_space +
          p.option_cost +
          p.data_quality +
          p.oos_evidence_confidence
      )
    );
    const penalty = prePenaltyTotal < best ? -6 : 0;
    return {
      ...row,
      family_conflict_penalty: penalty,
      total: row.total + penalty,
    };
  });
}

/** Rank all eligible primaries with factor breakdown. Static priority is tie-break only. */
export function rankPrimaryCandidates(
  verdicts: readonly PlaybookMatchVerdict[],
  ctx: PrimaryRankContext = {},
  staticPriorityIndex: Readonly<Partial<Record<PlaybookId, number>>> = {},
): PrimaryRankBreakdown[] {
  const candidates = verdicts.filter((v) => v.trigger_fired && v.regime_eligible);
  const rows: PrimaryRankBreakdown[] = candidates.map((v) => {
    const parts = scoreCandidate(v, ctx);
    const tiebreak = staticPriorityIndex[v.playbook_id] ?? 999;
    const total =
      parts.setup_completeness +
      parts.regime_compatibility +
      parts.fidelity_tier +
      parts.trigger_freshness +
      parts.invalidation_buffer +
      parts.target_space +
      parts.option_cost +
      parts.data_quality +
      parts.oos_evidence_confidence;
    return {
      ...parts,
      family_conflict_penalty: 0,
      static_priority_tiebreak: -tiebreak * 0.001,
      total,
    };
  });

  const withConflicts = applyFamilyConflictPenalties(rows);
  withConflicts.sort((a, b) => {
    if (Math.abs(b.total - a.total) > 0.001) return b.total - a.total;
    return a.static_priority_tiebreak - b.static_priority_tiebreak;
  });
  return withConflicts;
}

export function buildPrimaryRankContext(input: {
  desk?: SpxDeskPayload | null;
  armed_poll_counts?: ReadonlyMap<string, number>;
  verdicts?: readonly PlaybookMatchVerdict[];
  option_spread_pct?: number | null;
  option_mid?: number | null;
  now_ms?: number;
}): PrimaryRankContext {
  const flags = input.desk ? playbookDataQualityFlags(input.desk) : undefined;
  const armedByPb = new Map<PlaybookId, number>();
  if (input.armed_poll_counts && input.verdicts) {
    for (const v of input.verdicts) {
      let max = 0;
      for (const [id, count] of input.armed_poll_counts) {
        if (id.includes(v.playbook_id)) max = Math.max(max, count);
      }
      armedByPb.set(v.playbook_id, max);
    }
  }
  return {
    desk: input.desk,
    data_quality_flags: flags,
    data_quality_mode: flags ? liveDataQualityMode(flags) : undefined,
    armed_polls_by_pb: armedByPb.size ? armedByPb : undefined,
    option_spread_pct: input.option_spread_pct,
    option_mid: input.option_mid,
    now_ms: input.now_ms,
  };
}
