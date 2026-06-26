import "server-only";

// ---------------------------------------------------------------------------
// DATA-CORRECTNESS AUDITOR — shared scorecard shape.
//
// This is the EXTENSIBLE contract for the layered verifier. Heat Maps (GEX/VEX/
// DEX/CHARM) is the first surface; the same shape is meant to carry desk, flows,
// Night's Watch, and Night Hawk checks later WITHOUT changing the scorecard schema.
//
// HONESTY PRINCIPLE (load-bearing): a metric is "independently-confirmed" ONLY when a
// SECOND independent source agreed within tolerance. With one source we can prove
// internal consistency (the served number equals what its own inputs imply) but NOT
// that the number is objectively right — that is "consistency-only", a COVERAGE GAP,
// never a false green. The status enum encodes that distinction so no surface can
// render a guarantee we cannot back.
// ---------------------------------------------------------------------------

/**
 * Per-metric verdict.
 *  - "pass"             — every applicable check held AND a second independent source confirmed it.
 *  - "consistency-only" — every applicable internal/invariant/sanity check held, but NO independent
 *                         oracle exists for this metric (so it is consistency-checked, not confirmed).
 *  - "flag"             — at least one check FAILED beyond tolerance: a definite or probable bug.
 *  - "skipped"          — the metric could not be evaluated (cold/empty matrix, market closed, no spot).
 */
export type MetricStatus = "pass" | "consistency-only" | "flag" | "skipped";

/** Which verification LAYER produced a check (strongest → weakest). */
export type VerifierLayer =
  | "shadow-recompute" // L1 — independent re-derivation of the key aggregates
  | "invariant" // L2 — relationships that MUST hold
  | "sanity-bound" // L3 — plausible ranges / no NaN-Inf / valid expiries
  | "cross-provider" // L4 — second independent source (the oracle)
  | "cross-tool" // L5 — same value reads identically across surfaces
  | "freshness"; // L6 — served asof within TTL

/** Outcome of a single check within a layer. */
export type CheckOutcome = "pass" | "consistency-only" | "flag" | "skipped";

/**
 * One atomic check result. `expected`/`actual`/`tolerance` are populated on flags (and on confirms
 * where the comparison is numeric) so the scorecard can show expected-vs-actual-vs-tolerance.
 */
export type CheckResult = {
  /** Stable id, e.g. "SPX:gex:invariant:strike-sum-eq-total". */
  id: string;
  layer: VerifierLayer;
  /** The metric this check concerns, e.g. "net_gex" | "king" | "gamma_flip" | "call_wall". */
  metric: string;
  outcome: CheckOutcome;
  /** Human one-liner describing what was checked / what diverged. */
  detail: string;
  /** Expected value (the independent / invariant-implied side), when numeric. */
  expected?: number | string | null;
  /** Actual served value, when numeric. */
  actual?: number | string | null;
  /** Tolerance the comparison used (absolute or fractional, described in `detail`). */
  tolerance?: number | null;
  /** True when this check was satisfied by an INDEPENDENT second source (counts toward "confirmed"). */
  independentlyConfirmed?: boolean;
};

/** Roll-up for one metric on one ticker. */
export type MetricScore = {
  ticker: string;
  /** e.g. "net_gex" | "king" | "gamma_flip" | "call_wall" | "put_wall" | "spot" | "freshness". */
  metric: string;
  status: MetricStatus;
  /** True when at least one cross-provider check confirmed this metric. */
  independentlyConfirmed: boolean;
  /** All checks that touched this metric (across layers). */
  checks: CheckResult[];
};

/** Roll-up for one ticker (all its metrics). */
export type TickerScore = {
  ticker: string;
  /** Worst status across the ticker's metrics. */
  status: MetricStatus;
  metrics: MetricScore[];
};

/** The full scorecard for one verifier run. */
export type CorrectnessScorecard = {
  /** ISO timestamp the run started. */
  ranAt: string;
  /** The surface verified, e.g. "heatmap". Extensible to "desk" | "flows" | etc. */
  surface: string;
  /** True when the market was open (closed-market thin data is legitimately stale → mostly skips). */
  marketOpen: boolean;
  perTicker: TickerScore[];
  /** Flattened counts for fast triage / cron payload. */
  totals: {
    metrics: number;
    pass: number;
    consistencyOnly: number;
    flags: number;
    skipped: number;
    /** Number of metrics that a second independent source confirmed. */
    independentlyConfirmed: number;
  };
  /** Every FLAG check, surfaced for the alert + the markdown report. */
  flags: CheckResult[];
  /** Coverage gaps = metrics that are consistency-only (no oracle today). */
  coverageGaps: Array<{ ticker: string; metric: string; reason: string }>;
  /** Per-surface note on what is confirmed vs consistency-only today (the honest summary). */
  note: string;
};

/** Numeric helper — symmetric fractional difference between two finite numbers. */
export function fractionalDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (!(denom > 0)) return 0;
  return Math.abs(a - b) / denom;
}

/** Combine many check outcomes into a single metric status (worst-wins, oracle promotes). */
export function rollUpMetricStatus(
  checks: CheckResult[]
): { status: MetricStatus; independentlyConfirmed: boolean } {
  if (checks.length === 0) return { status: "skipped", independentlyConfirmed: false };
  const hasFlag = checks.some((c) => c.outcome === "flag");
  const confirmed = checks.some((c) => c.independentlyConfirmed === true && c.outcome !== "flag");
  // A metric with only skipped checks is skipped.
  const allSkipped = checks.every((c) => c.outcome === "skipped");
  if (hasFlag) return { status: "flag", independentlyConfirmed: confirmed };
  if (allSkipped) return { status: "skipped", independentlyConfirmed: false };
  if (confirmed) return { status: "pass", independentlyConfirmed: true };
  // Everything that ran held, but no independent oracle confirmed it → consistency-only.
  return { status: "consistency-only", independentlyConfirmed: false };
}

/** Worst status across a set of metric statuses (for the ticker / run roll-up). */
export function worstStatus(statuses: MetricStatus[]): MetricStatus {
  if (statuses.includes("flag")) return "flag";
  if (statuses.includes("consistency-only")) return "consistency-only";
  if (statuses.includes("pass")) return "pass";
  return "skipped";
}
