// PR-N7: Overnight merit-tier engine — the Night Hawk analogue of the 0DTE tier
// engine (src/lib/zerodte/tiers.ts). Ranks plays A/B/C from pinned evidence at
// build time, with the same honesty spine: A+ is NOT assignable, only earned from
// the measured record (displayTierFor).
//
// The root cause this fixes: convictionFromScore (scorer.ts:707-712) mapped
// ≥70 → A+, ≥55 → A, ≥40 → B, else C. The measured overnight track record
// showed a top-band INVERSION identical to the 0DTE one:
//   A+ (≥70): 0 wins / 1 loss
//   A  (55-69): avg −0.55%
//   B  (40-54): avg +2.99% — the best performer
// The mechanical score→letter mapping over-rewarded high raw scores, exactly as
// the 0DTE F-5 forensics found independently.
//
// DESIGN: the tier function scores on factors the raw composite DOESN'T already
// capture: score BAND placement (where in the measured track record), signal
// BREADTH (how many dimensions agree, not just the total), and binary-event RISK
// (earnings tomorrow into an overnight hold). The regime effect is already baked
// into scored.score via computeRegimeMultiplier — no double-counting here.
//
// Pure and deterministic: same inputs → same tier + same factors. No IO, no clock.

/** Assignable tiers, best → worst. "A+" is deliberately NOT here — see rule 1. */
export type NighthawkTier = "A" | "B" | "C";

/** What a pane may display: assignable tiers plus the earned "A+" promotion.
 *  The gap between this type and NighthawkTier IS the honesty model. */
export type NighthawkDisplayTier = "A+" | NighthawkTier;

/** One human-readable reason the tier is what it is. */
export type NighthawkTierFactor = {
  label: string;
  direction: "up" | "down";
  detail: string;
};

export type NighthawkTierAssignment = {
  tier: NighthawkTier;
  factors: NighthawkTierFactor[];
};

/** The evidence the tier function ranks on. ALL nullable — a missing field is an
 *  evidence gap, and evidence gaps degrade (never upgrade). */
export type NighthawkTierInput = {
  /** Composite score from scoreCandidate (regime-adjusted). */
  score: number | null;
  /** Count of scoring dimensions with material positive contribution. */
  confirmingSignals: number | null;
  /** Whether the play faces a binary earnings event tomorrow. */
  earningsRisk: boolean;
};

// ── A+ unlock — the honesty spine ───────────────────────────────────────────────
export const NH_TIER_APLUS_UNLOCK = { minGraded: 10, minWinRatePct: 80 } as const;

export function nhDisplayTierFor(tier: NighthawkTier, aplusUnlocked: boolean): NighthawkDisplayTier {
  return tier === "A" && aplusUnlocked ? "A+" : tier;
}

// ── Score bands (overnight-specific, from measured track record) ─────────────────
// The old B band (40-54) ran +2.99% avg — the best. The old A band (55-69) ran
// −0.55%. The old A+ band (70+) went 0/1. So the overnight prime band is 40-55,
// and the top band (70+) is discounted and capped, mirroring the 0DTE approach.

/** Prime band floor — the measured overnight sweet spot starts here. */
export const NH_SCORE_PRIME_MIN = 40;
/** Prime band ceiling — above this the measured return degrades. */
export const NH_SCORE_PRIME_MAX = 55;
/** Top-band edge where the measured inversion starts. */
export const NH_SCORE_TOP_MIN = 70;

export const W_NH_SCORE_PRIME = 2;
export const W_NH_SCORE_MID = 1;
/** Deliberately equal to W_NH_SCORE_MID — measured top-band inversion. */
export const W_NH_SCORE_TOP = 1;
export const W_NH_SCORE_BELOW_FLOOR = -2;

// ── Confirming signals (signal breadth) ─────────────────────────────────────────
/** Strong multi-dimensional support: ≥3 of 7 dimensions positive. */
export const NH_STRONG_SIGNALS_MIN = 3;
export const W_NH_SIGNALS_STRONG = 2;
/** Adequate support: exactly 2 dimensions. */
export const NH_OK_SIGNALS_MIN = 2;
export const W_NH_SIGNALS_OK = 1;

// ── Earnings risk ───────────────────────────────────────────────────────────────
export const W_NH_EARNINGS_RISK = -1;

// ── Tier bands over summed points ───────────────────────────────────────────────
/** "A" needs two independent strong positives with nothing dragging. */
export const NH_TIER_A_MIN_POINTS = 3;
/** "B" needs the evidence to net positive at all. */
export const NH_TIER_B_MIN_POINTS = 1;

const NH_TIER_RANK: Record<NighthawkTier, number> = { A: 2, B: 1, C: 0 };

function nhCapTier(tier: NighthawkTier, cap: NighthawkTier): NighthawkTier {
  return NH_TIER_RANK[cap] < NH_TIER_RANK[tier] ? cap : tier;
}

/** Ordinal rank for overnight conviction letters (higher = stronger). */
export function nhConvictionRank(conviction: string): number {
  const c = conviction.trim().toUpperCase();
  if (c === "A+") return 4;
  if (c === "A") return 3;
  if (c === "B") return 2;
  if (c === "C") return 1;
  return 2;
}

/**
 * Assign the merit tier for ONE overnight play from its pinned evidence.
 * Pure and deterministic. The returned factors are the complete argument for
 * the tier — every point and every cap shows up as a renderable line.
 */
export function assignNighthawkTier(input: NighthawkTierInput): NighthawkTierAssignment {
  const factors: NighthawkTierFactor[] = [];
  let points = 0;
  let ceiling: NighthawkTier = "A";

  // ── Score band (overnight-measured: 40-55 prime, 70+ inverted) ────────────────
  if (input.score == null) {
    ceiling = nhCapTier(ceiling, "C");
    factors.push({
      label: "Score missing",
      direction: "down",
      detail: "No composite score — unrankable evidence caps the tier at C.",
    });
  } else if (input.score < NH_SCORE_PRIME_MIN) {
    points += W_NH_SCORE_BELOW_FLOOR;
    factors.push({
      label: "Score below floor",
      direction: "down",
      detail: `Score ${Math.round(input.score)} is under ${NH_SCORE_PRIME_MIN} — below the measured viability threshold.`,
    });
  } else if (input.score >= NH_SCORE_TOP_MIN) {
    points += W_NH_SCORE_TOP;
    ceiling = nhCapTier(ceiling, "B");
    factors.push({
      label: "Score 70+ (discounted)",
      direction: "up",
      detail:
        `Score ${Math.round(input.score)} counts as mid-band positive — the measured overnight top-band ` +
        "inversion (A+ ≥70 went 0/1, A 55-69 avg −0.55%) means raw-score maximalism is not earned credit.",
    });
    factors.push({
      label: "Score 70+ tier cap",
      direction: "down",
      detail:
        "Score ≥70 caps the tier at B — A-tier must come through the 40-55 prime band where the measured edge lives.",
    });
  } else if (input.score >= NH_SCORE_PRIME_MIN && input.score < NH_SCORE_PRIME_MAX) {
    points += W_NH_SCORE_PRIME;
    factors.push({
      label: "Prime score band",
      direction: "up",
      detail: `Score ${Math.round(input.score)} sits in 40-55 — the overnight sweet spot (B-tier ran +2.99% avg).`,
    });
  } else {
    points += W_NH_SCORE_MID;
    factors.push({
      label: "Mid score band",
      direction: "up",
      detail: `Score ${Math.round(input.score)} in 55-69 — above the prime band, modest measured returns.`,
    });
  }

  // ── Confirming signals (breadth of evidence) ─────────────────────────────────
  if (input.confirmingSignals == null) {
    ceiling = nhCapTier(ceiling, "B");
    factors.push({
      label: "Signal count missing",
      direction: "down",
      detail: "No confirming-signal count — evidence breadth unknown, A is out of reach.",
    });
  } else if (input.confirmingSignals >= NH_STRONG_SIGNALS_MIN) {
    points += W_NH_SIGNALS_STRONG;
    factors.push({
      label: "Strong signal breadth",
      direction: "up",
      detail: `${input.confirmingSignals} of 7 dimensions confirming — broad multi-factor support.`,
    });
  } else if (input.confirmingSignals >= NH_OK_SIGNALS_MIN) {
    points += W_NH_SIGNALS_OK;
    factors.push({
      label: "Adequate signal breadth",
      direction: "up",
      detail: `${input.confirmingSignals} confirming dimensions — minimum adequate support.`,
    });
  } else {
    ceiling = nhCapTier(ceiling, "B");
    factors.push({
      label: "Thin signals",
      direction: "down",
      detail: `Only ${input.confirmingSignals} confirming dimension(s) — thin evidence caps at B.`,
    });
  }

  // ── Earnings risk (binary event into an overnight hold) ──────────────────────
  if (input.earningsRisk) {
    points += W_NH_EARNINGS_RISK;
    ceiling = nhCapTier(ceiling, "B");
    factors.push({
      label: "Earnings risk",
      direction: "down",
      detail: "Binary earnings event tomorrow — overnight hold into an event caps at B and penalizes.",
    });
  }

  const base: NighthawkTier =
    points >= NH_TIER_A_MIN_POINTS ? "A" : points >= NH_TIER_B_MIN_POINTS ? "B" : "C";
  return { tier: nhCapTier(base, ceiling), factors };
}

/** Build a NighthawkTierInput from a ScoredCandidate's fields. */
export function nhTierInputFromScored(scored: {
  score: number;
  confirming_signals?: number;
  earnings_risk?: boolean;
}): NighthawkTierInput {
  return {
    score: scored.score,
    confirmingSignals: scored.confirming_signals ?? null,
    earningsRisk: scored.earnings_risk ?? false,
  };
}
