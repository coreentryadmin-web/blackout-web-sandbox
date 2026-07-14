// PR-N11 — auto-tuning in OBSERVATION mode (SHADOW ONLY).
//
// WHAT THIS IS. A read-only engine that, from the SAME rolling debrief evidence the desk
// already reviews (debrief-aggregate.ts's gate-validation + improvement queue), PROPOSES
// parameter adjustments for a small whitelist of live thresholds — and does nothing else.
// It NEVER mutates a gate, a constant, or a live decision. Every proposal it emits carries
// `applied: false`, and the top-level blob carries `mode: "observation"` and `applied: false`.
//
// WHY IT IS SAFE (the rails, spelled out).
//   1. WHITELIST — only the two publish-gate thresholds below are tunable. A param not on
//      TUNABLE_PARAMS can never appear in a proposal.
//   2. EVIDENCE BAR — a proposal is only PROPOSED (`evidence_bar_cleared: true`, non-null
//      `proposed_value`) when the evidence clears BOTH a minimum sample size (n ≥
//      EVIDENCE_MIN_N, and never a low_n bucket) AND a minimum effect size. Below the bar the
//      param still appears (transparency) but as observe-only: `proposed_value: null`,
//      `evidence_bar_cleared: false`, with the reason.
//   3. HARD BOUNDS — a proposed value is CLAMPED to the param's [min,max]; a proposal that
//      would leave bounds is pinned at the bound and annotated. The engine cannot propose an
//      out-of-range value even in principle.
//   4. NO WRITE PATH — this module returns data; it imports nothing that mutates state and is
//      wired only to a PINNED observation blob for human review. APPLYING a proposal is a
//      FUTURE, separately-gated step (it would need: this whitelist + evidence bar + hard
//      bounds ALREADY here, PLUS an apply-time re-check, an audit record, and an auto-revert
//      guard — none of which exist yet, by design). Until then: observation only.
//
// Pure module: no I/O, no clock, no db imports. The cron computes the rolling report and
// passes it in; the pinning + human-review surface live outside this file.

import {
  IMPROVEMENT_MIRROR_DELTA_PTS,
  IMPROVEMENT_BLOCKED_WINNER_RATE_PCT,
  type NighthawkDebriefReport,
  type GateMirrorLine,
  type GateBlockedValueLine,
} from "./debrief-aggregate";
import { GATE_BAND_MAX_DISTANCE_PCT, GATE_TARGET_MAX_ATR_MULTIPLE } from "./publish-gates";
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";

export const AUTO_TUNE_OBSERVE_VERSION = 1;

/** The evidence must cover at least this many graded rows before ANY proposal is minted. Set
 *  to the platform LOW-N threshold: below it, buckets are already flagged low_n and we refuse
 *  to lean on them (the same discipline debrief-aggregate.ts enforces for suggestions). */
export const EVIDENCE_MIN_N = LOW_N_THRESHOLD;

/** One tunable live parameter and the hard bounds a proposal may never leave. `step` is the
 *  fixed, conservative increment a single observation cycle may propose — small on purpose so
 *  no one cycle can lurch a threshold. */
export type TunableParam = {
  id: string;
  /** The exported constant this param mirrors (documentation only — this module NEVER writes it). */
  constant: string;
  current_value: number;
  min: number;
  max: number;
  step: number;
  /** Human note on what the param controls and where applying it would eventually live. */
  note: string;
};

/** The WHITELIST. Adding a param here is the ONLY way to make it tunable — and even then it
 *  is observation-only until the apply path (future, separately gated) is built. */
export const TUNABLE_PARAMS: TunableParam[] = [
  {
    id: "band_detached_max_distance_pct",
    constant: "GATE_BAND_MAX_DISTANCE_PCT (publish-gates.ts)",
    current_value: GATE_BAND_MAX_DISTANCE_PCT,
    min: 1.0,
    max: 6.0,
    step: 0.5,
    note: "max spot→band distance (%) before G-N1 rejects a play as a detached band",
  },
  {
    id: "target_max_atr_multiple",
    constant: "GATE_TARGET_MAX_ATR_MULTIPLE (publish-gates.ts)",
    current_value: GATE_TARGET_MAX_ATR_MULTIPLE,
    min: 1.0,
    max: 4.0,
    step: 0.25,
    note: "max target distance in ATR14 multiples before G-N2 rejects a target as unreachable",
  },
];

/** Which gate each tunable param governs, so the evidence lookup is explicit (not a string
 *  match on the improvement queue). */
const PARAM_GATE: Record<string, GateMirrorLine["gate"]> = {
  band_detached_max_distance_pct: "band_detached",
  target_max_atr_multiple: "target_unreachable",
};

export type TuneDirection = "tighten" | "loosen";

export type TuningProposal = {
  param: string;
  constant: string;
  current_value: number;
  /** The bounded value this cycle proposes, or NULL when the evidence bar was not cleared. */
  proposed_value: number | null;
  direction: TuneDirection | null;
  bounds: { min: number; max: number };
  /** True only when a direction + a bounded proposed_value were minted. */
  evidence_bar_cleared: boolean;
  /** Every proposal, cleared bar or not, records the evidence it was judged on. */
  evidence: {
    signal: string;
    n: number;
    /** The effect size that drove (or failed to drive) the proposal (pts or %). */
    effect: number | null;
    low_n: boolean;
  };
  /** ALWAYS false. Applying is a future, separately-gated step (see file header). */
  applied: false;
  rationale: string;
};

export type TuningObservations = {
  version: typeof AUTO_TUNE_OBSERVE_VERSION;
  /** Observation mode, forever, in this module. */
  mode: "observation";
  /** ALWAYS false — no proposal in this blob has been (or can be) applied by this engine. */
  applied: false;
  generated_at?: string;
  proposals: TuningProposal[];
  note: string;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Clamp `v` into [min,max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Decide the proposal for ONE param from its gate evidence. Deterministic and conservative:
 *  - published MIRROR delta ≥ IMPROVEMENT_MIRROR_DELTA_PTS (and not low_n, n ≥ EVIDENCE_MIN_N)
 *    ⇒ the gate SEPARATES real losers from winners ⇒ propose TIGHTEN by one step;
 *  - else BLOCKED-VALUE would-have-won rate ≥ IMPROVEMENT_BLOCKED_WINNER_RATE_PCT (and not
 *    low_n, graded_n ≥ EVIDENCE_MIN_N) ⇒ the gate is removing WINNERS ⇒ propose LOOSEN by one
 *    step;
 *  - else observe-only (proposed_value null) with the reason.
 * The proposed value is always CLAMPED to the param's hard bounds.
 */
export function proposeForParam(
  param: TunableParam,
  mirror: GateMirrorLine | undefined,
  blocked: GateBlockedValueLine | undefined
): TuningProposal {
  const bounds = { min: param.min, max: param.max };

  // Signal A — the published mirror says the gate separates losers ⇒ tighten.
  if (
    mirror &&
    mirror.delta_win_rate_pts != null &&
    mirror.delta_win_rate_pts >= IMPROVEMENT_MIRROR_DELTA_PTS &&
    !mirror.would_block.low_n &&
    !mirror.would_pass.low_n &&
    mirror.would_block.n + mirror.would_pass.n >= EVIDENCE_MIN_N
  ) {
    const raw = param.current_value - param.step; // tighten = smaller max-distance / max-multiple
    const proposed = round2(clamp(raw, param.min, param.max));
    const atBound = proposed !== round2(raw);
    return {
      param: param.id,
      constant: param.constant,
      current_value: param.current_value,
      proposed_value: proposed,
      direction: "tighten",
      bounds,
      evidence_bar_cleared: true,
      evidence: {
        signal: `published_mirror:${mirror.gate}`,
        n: mirror.would_block.n + mirror.would_pass.n,
        effect: mirror.delta_win_rate_pts,
        low_n: false,
      },
      applied: false,
      rationale:
        `plays the ${mirror.gate} gate would have blocked ran ${mirror.delta_win_rate_pts} pts worse than passes on ` +
        `the published record (bar ${IMPROVEMENT_MIRROR_DELTA_PTS} pts) — OBSERVE-ONLY proposal to tighten ` +
        `${param.id} by ${param.step} to ${proposed}${atBound ? " (clamped to hard bound)" : ""}. Not applied.`,
    };
  }

  // Signal B — the gate is blocking would-be winners ⇒ loosen.
  if (
    blocked &&
    blocked.would_have_won_rate_pct != null &&
    blocked.would_have_won_rate_pct >= IMPROVEMENT_BLOCKED_WINNER_RATE_PCT &&
    !blocked.low_n &&
    blocked.graded_n >= EVIDENCE_MIN_N
  ) {
    const raw = param.current_value + param.step; // loosen = larger max-distance / max-multiple
    const proposed = round2(clamp(raw, param.min, param.max));
    const atBound = proposed !== round2(raw);
    return {
      param: param.id,
      constant: param.constant,
      current_value: param.current_value,
      proposed_value: proposed,
      direction: "loosen",
      bounds,
      evidence_bar_cleared: true,
      evidence: {
        signal: `blocked_value:${blocked.gate}`,
        n: blocked.graded_n,
        effect: blocked.would_have_won_rate_pct,
        low_n: false,
      },
      applied: false,
      rationale:
        `the ${blocked.gate} gate blocked plays that would have won ${blocked.would_have_won_rate_pct}% of the time ` +
        `(bar ${IMPROVEMENT_BLOCKED_WINNER_RATE_PCT}%, n=${blocked.graded_n}) — OBSERVE-ONLY proposal to loosen ` +
        `${param.id} by ${param.step} to ${proposed}${atBound ? " (clamped to hard bound)" : ""}. Not applied.`,
    };
  }

  // Below the bar — observe only. Record the strongest evidence we DID see (or its absence).
  const n = (mirror ? mirror.would_block.n + mirror.would_pass.n : 0);
  const gradedN = blocked?.graded_n ?? 0;
  const effect = mirror?.delta_win_rate_pts ?? blocked?.would_have_won_rate_pct ?? null;
  const low_n = (mirror?.would_block.low_n ?? true) || (mirror?.would_pass.low_n ?? true) || (blocked?.low_n ?? true);
  return {
    param: param.id,
    constant: param.constant,
    current_value: param.current_value,
    proposed_value: null,
    direction: null,
    bounds,
    evidence_bar_cleared: false,
    evidence: {
      signal: mirror ? `published_mirror:${mirror.gate}` : blocked ? `blocked_value:${blocked.gate}` : "no_evidence",
      n: Math.max(n, gradedN),
      effect,
      low_n,
    },
    applied: false,
    rationale:
      `evidence did not clear the bar (need n ≥ ${EVIDENCE_MIN_N}, not low_n, and mirror ≥ ` +
      `${IMPROVEMENT_MIRROR_DELTA_PTS} pts or blocked-winner ≥ ${IMPROVEMENT_BLOCKED_WINNER_RATE_PCT}%) — ` +
      `holding ${param.id} at ${param.current_value}. Observation only.`,
  };
}

/**
 * Build the OBSERVATION blob from a rolling debrief report. Every whitelisted param produces
 * exactly one proposal (cleared-bar or observe-only). NOTHING here mutates a live value —
 * `mode: "observation"`, `applied: false`, and each proposal `applied: false`.
 */
export function buildTuningObservations(report: NighthawkDebriefReport): TuningObservations {
  const mirrorByGate = new Map<GateMirrorLine["gate"], GateMirrorLine>(
    report.gate_validation.published_mirror.map((m) => [m.gate, m])
  );
  const blockedByGate = new Map<string, GateBlockedValueLine>(
    report.gate_validation.blocked_value.map((b) => [b.gate, b])
  );

  const proposals = TUNABLE_PARAMS.map((param) => {
    const gate = PARAM_GATE[param.id];
    return proposeForParam(param, gate ? mirrorByGate.get(gate) : undefined, gate ? blockedByGate.get(gate) : undefined);
  });

  return {
    version: AUTO_TUNE_OBSERVE_VERSION,
    mode: "observation",
    applied: false,
    proposals,
    note:
      "SHADOW / observation-only. No proposal here has been applied to any live gate or threshold. " +
      "Applying is a future, separately-gated step requiring an apply-time re-check, an audit record, " +
      "and an auto-revert guard (none of which exist yet). Rails enforced here: whitelist + evidence bar " +
      "+ hard bounds.",
  };
}
