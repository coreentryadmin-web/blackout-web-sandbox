// 0DTE gate-calibration analyzer (PR-C) — the evidence loop the calibration-mode
// gates were shipped FOR. G-4 (VIX regime) and G-6 (cross-system conflict) run in
// CALIBRATION mode (./gates.ts): they never block, they only pin a would-block
// verdict onto every committed row's gate_calibration_json. This module closes the
// loop: it buckets GRADED plays by each gate's pinned verdict and answers, with
// per-bucket n / wins / win rate / avg premium P&L, whether the gate's would-block
// bucket actually underperforms — i.e. whether the gate has EARNED enforcement.
//
// Why this exists (forensic priors, docs/audit/NIGHTHAWK-0DTE-DECISION.md):
// - F-1: day-open VIX 15-17 → 69.2% WR (n=13) vs 17-20 → 25.0% WR (n=12) — the
//   strongest split in the dataset, but LOW-N, which is exactly why G-4 ships as
//   calibration-first: thresholds graduate on evidence, never on vibes.
// - F-2: score 55-64 → 18.8% WR (n=16), below the 33% breakeven of the −50/+100
//   payoff — the evidence that set G-3's floor at 65. The score-band section here
//   keeps producing that same cut going forward so the floor can be re-argued from
//   data (it is NEVER auto-moved by this module).
// - F-5: the top conviction band inverts on three surfaces independently (e.g.
//   Slayer 85+ → 33.3% vs 75-84 → 63.6%) — why the bands split 75-84 vs 85+
//   instead of one "75+" bucket.
//
// Pure core (analyzeGateCalibration + helpers) with a thin data layer at the bottom
// (buildZeroDteCalibrationReport) — same split as ./record.ts / ./entry-context.ts.
// The pure core takes rows and returns a report; no clocks, no providers, no DB.

import type { ZeroDteSetupLogRow } from "@/lib/db";
import { LOW_N_THRESHOLD, isGradedZeroDteRow, isZeroDteWin, scoreForBanding } from "./record";
import { ZERODTE_SCORE_FLOOR } from "./gates";
import { TIER_APLUS_UNLOCK, tierFromEntryContext, type ZeroDteTier } from "./tiers";
import type { SkipCounterfactual } from "./skip-grading";

/** Methodology label served with every report — the honest-record rule (record.ts):
 *  plan-outcome grades on option premium, never blended with other methodologies. */
export const ZERODTE_CALIBRATION_METHODOLOGY =
  "0DTE gate calibration over GRADED ledger plays (plan-outcome grades on option premium, " +
  "stop -50% / trim +100% / hard exit 15:30 ET). Calibration-mode gates (G-4 VIX, G-6 conflict) " +
  "are bucketed by their pinned would-block verdict; a gate graduates to enforcing only when " +
  "its would-block bucket is large enough AND measurably worse than would-pass. Buckets under " +
  `n=${LOW_N_THRESHOLD} are low_n and never produce a recommendation. Blocked-value lines grade ` +
  "hard-gate SKIPs counterfactually (see skip-grading.ts) — premium basis only when the contract " +
  "path is real, underlying-direction basis otherwise, never fabricated premium P&L.";

// ── Graduation thresholds (deterministic, conservative) ─────────────────────────
/** A gate may graduate calibration → enforcing only once its would-block bucket has
 *  at least this many GRADED plays. 10, not LOW_N_THRESHOLD (5): the priors that
 *  motivated these gates were themselves n=12/n=13 cuts (F-1) that we explicitly
 *  refused to enforce on — the graduating evidence must be at least the same order,
 *  and it must be would-BLOCK evidence specifically (the bucket the gate would have
 *  removed), not total sample size. */
export const ENFORCE_MIN_BLOCK_N = 10;
/** The would-block bucket's win rate must be at least this many percentage points
 *  WORSE than would-pass. 15 pts is deliberately far above bucket noise at n≈10-20
 *  (one flipped play in an n=10 bucket moves its rate by 10 pts) and is roughly a
 *  third of the F-1 spread (69.2% vs 25.0% ≈ 44 pts) — a real regime split should
 *  clear it easily; a coin-flip difference never should. */
export const ENFORCE_MIN_DELTA_PTS = 15;
/** Float guard for the ">= 15 pts" comparison: win rates are ratios of small
 *  integers scaled by 100, so a mathematically-exact 15.0 delta can land at
 *  14.999999999999996 in IEEE754. The epsilon only forgives float dust, never a
 *  genuinely smaller delta (the next representable real-data delta below 15 at
 *  n<=1000 is orders of magnitude further away than 1e-9). */
const DELTA_EPSILON = 1e-9;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** The row shape the analyzer needs — a structural subset of ZeroDteSetupLogRow so
 *  tests build fixtures without the full 30-field ledger row. */
export type CalibrationPlayRow = Pick<
  ZeroDteSetupLogRow,
  | "session_date"
  | "ticker"
  | "direction"
  | "score_max"
  | "plan_outcome"
  | "plan_pnl_pct"
  | "entry_context"
  | "gate_calibration_json"
>;

export type CalibrationBucket = {
  label: string;
  n: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
  /** n < LOW_N_THRESHOLD — UIs must badge these; recommendations never rest on them. */
  low_n: boolean;
};

export type CalibrationGateKey = "g4_vix" | "g6_conflict";

export type GateRecommendation = {
  gate: CalibrationGateKey;
  verdict: "enforce" | "keep_calibrating" | "insufficient_data";
  evidence: {
    would_block: CalibrationBucket;
    would_pass: CalibrationBucket;
    /** would_pass win rate minus would_block win rate, percentage points — positive
     *  means the gate's block verdict is catching genuinely worse plays. Null until
     *  both buckets have at least one graded play. */
    delta_win_rate_pts: number | null;
    /** Rows graded but carrying no usable verdict for this gate (pre-column rows,
     *  or G-4 with day-open VIX unavailable) — reported, never silently dropped. */
    no_verdict_n: number;
    min_block_n: number;
    min_delta_pts: number;
    reason: string;
  };
};

export type BlockedValueLine = {
  gate_failed: string;
  /** Counterfactually graded skips (verdict != ungradeable). */
  n: number;
  ungradeable: number;
  would_have_won: number;
  would_have_won_rate_pct: number | null;
  by_basis: { premium: number; underlying: number };
  low_n: boolean;
};

export type CalibrationReport = {
  methodology: string;
  window: { since: string; through: string; days: number };
  total_rows: number;
  graded_plays: number;
  gates: GateRecommendation[];
  /** Per-band record over graded plays — EVIDENCE for moving G-3's floor, which is
   *  never auto-moved (the verdict on the floor stays a human/PR decision). */
  score_bands: CalibrationBucket[];
  score_floor: { current: number; note: string };
  /** What the hard gates blocked, graded counterfactually — a gate that blocks
   *  winners shows up here (LOW-N discipline identical to the buckets above). */
  blocked_value: BlockedValueLine[];
  /** Measured record of the merit tiers (PR-F) — where A+ is earned or withheld
   *  and where a mis-weighted tier function gets caught (tier_inversion). */
  tier_record: TierRecordAnalysis;
  available: boolean;
};

// ── Merit-tier record analysis (PR-F) ─────────────────────────────────────────────
// The tier function (./tiers.ts) was seeded from the SAME forensic priors that
// produced the score-band inversion finding (F-5) — so it gets the SAME treatment
// the scorers got: its buckets are continuously measured against graded outcomes,
// and if a lower tier outperforms a higher one the report says so in a machine-
// readable flag instead of letting the mis-weighting hide. This is also the ONLY
// place "A+" can come from: the display promotion is computed here from the A
// bucket's measured record against TIER_APLUS_UNLOCK, never at entry time.

/** A lower tier's win rate must beat a higher tier's by MORE than this many
 *  percentage points to flag an inversion. 10 pts = one flipped play at the n=10
 *  minimum — anything under that is bucket noise, not a broken weight function. */
export const TIER_INVERSION_DELTA_PTS = 10;
/** Both buckets need at least this many graded plays before an inversion can be
 *  called. Same bar as ENFORCE_MIN_BLOCK_N and TIER_APLUS_UNLOCK.minGraded: the
 *  F-5 inversion cuts were themselves LOW-N and we refused to act on any single
 *  one — a claim that the tier weights are provably wrong needs the same order of
 *  evidence as a claim that they are provably right. */
export const TIER_INVERSION_MIN_N = 10;

/** Assignable-tier bucket order, best → worst — F never appears here (skips never
 *  reach the graded ledger) and A+ is a display promotion, not a bucket. */
const TIER_ORDER: readonly ZeroDteTier[] = ["A", "B", "C"];

export type TierRecordBucket = CalibrationBucket & { tier: ZeroDteTier };

export type TierInversion = {
  /** The tier that SHOULD have won (ranked higher by the entry function). */
  higher: ZeroDteTier;
  /** The tier that actually beat it on the record. */
  lower: ZeroDteTier;
  /** lower's win rate minus higher's, percentage points (rounded for display;
   *  the flag itself is computed on unrounded rates). */
  delta_pts: number;
};

export type TierRecordAnalysis = {
  /** All three assignable tiers, always present (n=0 buckets included) — stable
   *  machine-readable shape, same rule as score_bands. */
  tiers: TierRecordBucket[];
  /** Graded rows with no pinned entry_context (pre-C-2) — tierFromEntryContext
   *  refuses to tier zero evidence, so they are counted here, never dumped into
   *  the C bucket where they would read as a measurement of the tier function. */
  untiered_n: number;
  /** TRUE when any lower tier's WR beats a higher tier's by >TIER_INVERSION_DELTA_PTS
   *  at n>=TIER_INVERSION_MIN_N each — the tier weights are then provably wrong,
   *  the same class of finding as the F-5 score-band inversion that seeded them. */
  tier_inversion: boolean;
  inversions: TierInversion[];
  /** The A+ unlock — the product's honesty spine. UIs display A+ ONLY when this
   *  says so (tiers.ts displayTierFor); the entry-time function cannot mint it. */
  aplus: {
    unlocked: boolean;
    min_graded: number;
    min_win_rate_pct: number;
    a_graded: number;
    a_win_rate_pct: number | null;
    note: string;
  };
};

/** Rows that also carry entry_context — what retroactive tiering reads. */
export type TierPlayRow = Pick<
  ZeroDteSetupLogRow,
  "plan_outcome" | "plan_pnl_pct" | "entry_context"
>;

/**
 * Per-tier measured record over GRADED plays, tiered retroactively from each row's
 * pinned entry_context (tierFromEntryContext — no backfill needed). Pure and
 * deterministic; LOW-N discipline identical to every other bucket in this module.
 */
export function analyzeTierRecord(rows: TierPlayRow[]): TierRecordAnalysis {
  const graded = rows.filter(isGradedZeroDteRow);
  const byTier = new Map<ZeroDteTier, TierPlayRow[]>(TIER_ORDER.map((t) => [t, []]));
  let untiered = 0;
  for (const r of graded) {
    const assigned = tierFromEntryContext(r.entry_context);
    if (assigned == null) untiered += 1;
    else byTier.get(assigned.tier)!.push(r);
  }
  const buckets: TierRecordBucket[] = TIER_ORDER.map((t) => ({
    tier: t,
    ...bucketOf(`tier ${t}`, byTier.get(t)!),
  }));

  // Monotonicity: every (higher, lower) pair, on UNROUNDED rates (same rationale
  // as the graduation delta). Strictly MORE than 10 pts — an exact-10 delta is the
  // one-flipped-play noise bound, and IEEE754 can render a true 10.0 as
  // 10.000000000000007 (e.g. 60% - 50% from n=10 buckets), so the epsilon forgives
  // float dust in the OTHER direction here: it keeps exact-10 from falsely firing.
  const inversions: TierInversion[] = [];
  for (let hi = 0; hi < TIER_ORDER.length; hi += 1) {
    for (let lo = hi + 1; lo < TIER_ORDER.length; lo += 1) {
      const higher = byTier.get(TIER_ORDER[hi]!)!;
      const lower = byTier.get(TIER_ORDER[lo]!)!;
      if (higher.length < TIER_INVERSION_MIN_N || lower.length < TIER_INVERSION_MIN_N) continue;
      const hiWr = rawWinRatePct(higher);
      const loWr = rawWinRatePct(lower);
      if (hiWr == null || loWr == null) continue;
      const delta = loWr - hiWr;
      if (delta > TIER_INVERSION_DELTA_PTS + DELTA_EPSILON) {
        inversions.push({ higher: TIER_ORDER[hi]!, lower: TIER_ORDER[lo]!, delta_pts: round1(delta) });
      }
    }
  }

  // A+ unlock: measured record of the A bucket vs TIER_APLUS_UNLOCK, on the
  // unrounded rate (a rounded 80.0 hiding a true 79.96 must not unlock). The
  // epsilon only forgives float dust on a mathematically-exact 80 (e.g. 8/10),
  // never a genuinely lower rate.
  const aRows = byTier.get("A")!;
  const aWr = rawWinRatePct(aRows);
  const unlocked =
    aRows.length >= TIER_APLUS_UNLOCK.minGraded &&
    aWr != null &&
    aWr >= TIER_APLUS_UNLOCK.minWinRatePct - DELTA_EPSILON;

  return {
    tiers: buckets,
    untiered_n: untiered,
    tier_inversion: inversions.length > 0,
    inversions,
    aplus: {
      unlocked,
      min_graded: TIER_APLUS_UNLOCK.minGraded,
      min_win_rate_pct: TIER_APLUS_UNLOCK.minWinRatePct,
      a_graded: aRows.length,
      a_win_rate_pct: aWr != null ? round1(aWr) : null,
      note: unlocked
        ? `A+ EARNED: the A bucket ran ${round1(aWr!)}% WR over ${aRows.length} graded plays ` +
          `(bar: ${TIER_APLUS_UNLOCK.minWinRatePct}% at n>=${TIER_APLUS_UNLOCK.minGraded}). Display may promote tier-A plays to A+.`
        : `A+ withheld: the A bucket has ${aRows.length} graded plays at ` +
          `${aWr != null ? `${round1(aWr)}%` : "n/a"} WR — the bar is ${TIER_APLUS_UNLOCK.minWinRatePct}% at ` +
          `n>=${TIER_APLUS_UNLOCK.minGraded}. A+ is earned from the record, never asserted at entry.`,
    },
  };
}

// ── Pure core ────────────────────────────────────────────────────────────────────

/** Extract the pinned would-block verdict for one calibration gate off a row's
 *  gate_calibration_json. Null = no usable verdict (row predates the column, blob
 *  malformed, or G-4 recorded tier "unknown" because day-open VIX was unavailable —
 *  gates.ts logs that honestly as would_block:false, but for CALIBRATION it is a
 *  non-observation, not a pass vote, so it must not dilute the would-pass bucket). */
export function gateVerdictOf(row: CalibrationPlayRow, gate: CalibrationGateKey): boolean | null {
  const blob = row.gate_calibration_json;
  if (blob == null || typeof blob !== "object") return null;
  const g = (blob as Record<string, unknown>)[gate];
  if (g == null || typeof g !== "object") return null;
  const rec = g as Record<string, unknown>;
  if (gate === "g4_vix" && rec.tier === "unknown") return null;
  return typeof rec.would_block === "boolean" ? rec.would_block : null;
}

/** The fields bucket math actually reads — lets the tier analysis reuse the exact
 *  same bucket/rate helpers on its narrower row shape (no casts). */
type GradablePlayRow = Pick<ZeroDteSetupLogRow, "plan_pnl_pct">;

function bucketOf(label: string, rows: GradablePlayRow[]): CalibrationBucket {
  const wins = rows.filter(isZeroDteWin).length;
  const pnls = rows.map((r) => r.plan_pnl_pct).filter((p): p is number => p != null);
  return {
    label,
    n: rows.length,
    wins,
    losses: rows.length - wins,
    win_rate_pct: rows.length > 0 ? round1((wins / rows.length) * 100) : null,
    avg_pnl_pct: pnls.length ? round2(pnls.reduce((a, b) => a + b, 0) / pnls.length) : null,
    low_n: rows.length < LOW_N_THRESHOLD,
  };
}

/** Unrounded win rate for the graduation delta — the rounded display rate loses up
 *  to 0.05 pts per bucket, enough to flip a boundary case at the 15-pt line. */
function rawWinRatePct(rows: GradablePlayRow[]): number | null {
  if (rows.length === 0) return null;
  return (rows.filter(isZeroDteWin).length / rows.length) * 100;
}

function recommendGate(gate: CalibrationGateKey, graded: CalibrationPlayRow[]): GateRecommendation {
  const withVerdict = graded.filter((r) => gateVerdictOf(r, gate) != null);
  const blockRows = withVerdict.filter((r) => gateVerdictOf(r, gate) === true);
  const passRows = withVerdict.filter((r) => gateVerdictOf(r, gate) === false);
  const wouldBlock = bucketOf("would_block", blockRows);
  const wouldPass = bucketOf("would_pass", passRows);
  const rawBlockWr = rawWinRatePct(blockRows);
  const rawPassWr = rawWinRatePct(passRows);
  const delta = rawBlockWr != null && rawPassWr != null ? rawPassWr - rawBlockWr : null;

  // Graduation ladder, most-restrictive check first. LOW-N discipline is absolute:
  // a low_n bucket on EITHER side never produces an enforce/keep verdict — the same
  // rule record.ts applies to the member-facing record ("never let a 2-sample
  // bucket read like a track record"), applied to gate policy.
  let verdict: GateRecommendation["verdict"];
  let reason: string;
  if (wouldBlock.n < ENFORCE_MIN_BLOCK_N || wouldPass.low_n || delta == null) {
    verdict = "insufficient_data";
    reason =
      wouldBlock.n < ENFORCE_MIN_BLOCK_N
        ? `would_block has n=${wouldBlock.n} graded plays — graduation requires n>=${ENFORCE_MIN_BLOCK_N} (the F-1 priors this gate rests on were themselves n=12/13 and deliberately NOT enforced).`
        : `would_pass has n=${wouldPass.n} (< ${LOW_N_THRESHOLD}) — no baseline to compare the block bucket against.`;
  } else if (delta >= ENFORCE_MIN_DELTA_PTS - DELTA_EPSILON) {
    verdict = "enforce";
    reason =
      `would_block ran ${wouldBlock.win_rate_pct}% WR (n=${wouldBlock.n}) vs would_pass ` +
      `${wouldPass.win_rate_pct}% (n=${wouldPass.n}) — ${round1(delta)} pts worse, clearing the ` +
      `${ENFORCE_MIN_DELTA_PTS}-pt graduation bar. The gate has earned enforcement.`;
  } else {
    verdict = "keep_calibrating";
    reason =
      `Delta is ${round1(delta)} pts (would_pass ${wouldPass.win_rate_pct}% vs would_block ` +
      `${wouldBlock.win_rate_pct}%) — under the ${ENFORCE_MIN_DELTA_PTS}-pt bar. The gate has not ` +
      `demonstrated enough harm to justify blocking real commits; keep pinning verdicts.`;
  }

  return {
    gate,
    verdict,
    evidence: {
      would_block: wouldBlock,
      would_pass: wouldPass,
      delta_win_rate_pts: delta != null ? round1(delta) : null,
      no_verdict_n: graded.length - withVerdict.length,
      min_block_n: ENFORCE_MIN_BLOCK_N,
      min_delta_pts: ENFORCE_MIN_DELTA_PTS,
      reason,
    },
  };
}

/** Score bands for the G-3 floor evidence. FINER than record.ts's member-facing
 *  3-band cut: F-5's finding is a top-band INVERSION (85+ underperforming 75-84 on
 *  three surfaces), which a single "75+" bucket would hide by construction. */
export const CALIBRATION_SCORE_BANDS = [
  "score <55",
  "score 55-64",
  "score 65-74",
  "score 75-84",
  "score 85+",
] as const;

export function calibrationScoreBand(score: number): (typeof CALIBRATION_SCORE_BANDS)[number] {
  if (score >= 85) return "score 85+";
  if (score >= 75) return "score 75-84";
  if (score >= 65) return "score 65-74";
  if (score >= 55) return "score 55-64";
  return "score <55";
}

/** One graded counterfactual skip as the analyzer consumes it — `counterfactual` is
 *  the raw JSONB payload; parsing is defensive (fail-soft on malformed blobs). */
export type GradedSkipInput = { gate_failed: string; counterfactual: unknown };

function isSkipCounterfactual(v: unknown): v is SkipCounterfactual {
  if (v == null || typeof v !== "object") return false;
  const rec = v as Record<string, unknown>;
  return (
    typeof rec.verdict === "string" &&
    ["would_have_won", "would_have_lost", "ungradeable"].includes(rec.verdict)
  );
}

function blockedValueLines(skips: GradedSkipInput[]): BlockedValueLine[] {
  const byGate = new Map<string, SkipCounterfactual[]>();
  for (const s of skips) {
    if (!s || typeof s.gate_failed !== "string" || !isSkipCounterfactual(s.counterfactual)) continue;
    byGate.set(s.gate_failed, [...(byGate.get(s.gate_failed) ?? []), s.counterfactual]);
  }
  return Array.from(byGate.entries())
    .map(([gate, cfs]) => {
      const graded = cfs.filter((c) => c.verdict !== "ungradeable");
      const won = graded.filter((c) => c.verdict === "would_have_won").length;
      return {
        gate_failed: gate,
        n: graded.length,
        ungradeable: cfs.length - graded.length,
        would_have_won: won,
        would_have_won_rate_pct: graded.length > 0 ? round1((won / graded.length) * 100) : null,
        by_basis: {
          premium: graded.filter((c) => c.basis === "premium").length,
          underlying: graded.filter((c) => c.basis === "underlying").length,
        },
        low_n: graded.length < LOW_N_THRESHOLD,
      };
    })
    // Most-material first (largest graded sample), name as the deterministic tiebreak.
    .sort((a, b) => b.n - a.n || a.gate_failed.localeCompare(b.gate_failed));
}

/**
 * The pure analyzer. `rows` = ledger rows for the window (graded or not — ungraded
 * rows are counted but never bucketed); `gradedSkips` = rejection rows that already
 * carry a counterfactual verdict (skip-grading.ts). Deterministic: no clock, no IO.
 */
export function analyzeGateCalibration(input: {
  rows: CalibrationPlayRow[];
  gradedSkips?: GradedSkipInput[];
  window: { since: string; through: string; days: number };
}): CalibrationReport {
  const graded = input.rows.filter(isGradedZeroDteRow);

  // Score bands: ALL five bands always present (n=0 buckets included) so the
  // machine-readable shape is stable regardless of what the window contained.
  const bandRows = new Map<string, CalibrationPlayRow[]>(CALIBRATION_SCORE_BANDS.map((b) => [b, []]));
  for (const r of graded) {
    bandRows.get(calibrationScoreBand(scoreForBanding(r)))!.push(r);
  }
  const scoreBands = CALIBRATION_SCORE_BANDS.map((b) => bucketOf(b, bandRows.get(b)!));

  return {
    methodology: ZERODTE_CALIBRATION_METHODOLOGY,
    window: input.window,
    total_rows: input.rows.length,
    graded_plays: graded.length,
    gates: [recommendGate("g4_vix", graded), recommendGate("g6_conflict", graded)],
    score_bands: scoreBands,
    score_floor: {
      current: ZERODTE_SCORE_FLOOR,
      note:
        "Evidence only — G-3's floor is never auto-moved by this report. Banded per-play so the " +
        "F-2 cut (55-64 = 18.8% WR, below the 33% breakeven) stays continuously re-measurable, and " +
        "split 75-84 vs 85+ so the F-5 top-band inversion is visible if it persists.",
    },
    blocked_value: blockedValueLines(input.gradedSkips ?? []),
    // Retro-tiered off each row's pinned entry_context — measurable from day one,
    // no tier column or backfill required (PR-F; stamping is the follow-up PR).
    tier_record: analyzeTierRecord(graded),
    available: graded.length > 0,
  };
}

// ── Thin data layer ──────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" in ET for an epoch-ms instant (same Intl idiom as entry-context.ts's
 *  formatEtStamp — local 3-liner rather than an import that would widen this
 *  module's graph to the nighthawk feature layer). */
function etYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;
// Same row budget rationale as the record route: the ledger caps out well under 15
// committed rows/session, so days*20 comfortably covers the window without an
// unbounded fetch.
const MAX_LEDGER_ROWS = 2000;

/**
 * Fetch + analyze. `nowMs` is a parameter (no Date.now() inside the lib — the route
 * supplies the clock). Fail-soft end to end: a DB/provider failure degrades to an
 * empty-input report (available:false), never a throw into the route.
 *
 * Dynamic RELATIVE imports keep this module's static graph pure (tests of the
 * analyzer never load pg/providers) — and CI's tsx ESM loader cannot resolve "@/"
 * aliases in dynamic import positions, so these MUST stay relative.
 */
export async function buildZeroDteCalibrationReport(opts: {
  days?: number;
  nowMs: number;
}): Promise<CalibrationReport> {
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.trunc(opts.days ?? DEFAULT_WINDOW_DAYS)));
  const through = etYmd(opts.nowMs);
  const since = etYmd(opts.nowMs - days * 24 * 60 * 60 * 1000);

  let rows: CalibrationPlayRow[] = [];
  let gradedSkips: GradedSkipInput[] = [];
  try {
    const db = await import("../db");
    if (db.dbConfigured()) {
      rows = await db.fetchZeroDteSetupLogRange(since, Math.min(MAX_LEDGER_ROWS, days * 20));
    }
  } catch {
    // Ledger unreadable — report over empty input (available:false), never a throw.
  }
  try {
    const skipMod = await import("./skip-grading");
    gradedSkips = await skipMod.fetchGradedSkips({ sinceYmd: since, throughYmd: through });
  } catch {
    // Skip grades unreadable — the gate buckets still stand on their own.
  }

  return analyzeGateCalibration({ rows, gradedSkips, window: { since, through, days } });
}
