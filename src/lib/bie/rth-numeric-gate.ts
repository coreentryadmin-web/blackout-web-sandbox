// BIE RTH NUMERIC-TRUTH GATE (task #83) — the "number Largo SAYS == the number the API SERVES"
// invariant, enforced at COMPOSITION time instead of only in the hardcore e2e after the fact.
//
// The gauntlet's numeric-truth battery checks, post-hoc, that every price Largo states equals what the
// clean JSON API serves at the answer's displayed precision. This gate moves that check INTO the
// composer: before a verdict ships, each stated level (flip / walls / max-pain / spot) is reconciled
// against a freshly-read authoritative snapshot. During RTH a disagreement beyond tolerance is a HARD
// failure — the composer must correct the number (to the fresh value) rather than emit a stale one.
// Off-hours the same disagreement degrades to a staleness-marked answer (reuse staleness.ts): a
// snapshot that reflects the prior close is honest as long as it is LABELLED, so we mark rather than
// "correct" toward a value that is itself the last close.
//
// PURE + deterministic (the clock is injectable), so the reconciliation and the RTH/off-hours branch
// are unit-tested directly without any live read. The server half (verdict.ts) supplies the snapshots.

import type { BieAnswerEnvelope, BieLevel } from "@/lib/bie/answer-envelope";

const RTH_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const RTH_CLOSE_MIN = 16 * 60; // 16:00 ET

/** The metrics the gate reconciles — the price levels a verdict states. */
export type NumericMetric = "spot" | "flip" | "call_wall" | "put_wall" | "max_pain";

/** Authoritative live values for the reconciled metrics (the "what the API serves" side). */
export type NumericTruth = Partial<Record<NumericMetric, number | null>>;

/** True when `now` is inside regular US equity trading hours (Mon–Fri 09:30–16:00 ET). Injectable
 *  clock so the RTH vs off-hours branch is deterministic in tests. */
export function isRegularTradingHoursNow(now: number = Date.now()): boolean {
  const et = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay(); // 0 = Sun … 6 = Sat
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN;
}

/** A number a verdict STATED, tagged with the metric it represents + how many decimals it was
 *  displayed with (the precision the match is judged at). */
export type StatedNumber = { metric: NumericMetric; value: number; decimals: number };

/** Map a level label (as verdict-core writes it) to the metric key the gate reconciles, or null. */
export function metricForLevelLabel(label: string): NumericMetric | null {
  const l = label.toLowerCase();
  if (l.includes("call wall")) return "call_wall";
  if (l.includes("put wall")) return "put_wall";
  if (l.includes("gamma flip") || l === "flip") return "flip";
  if (l.includes("max pain")) return "max_pain";
  if (l.includes("spot")) return "spot";
  return null;
}

/** How many decimals a number was rendered with (verdict-core uses toLocaleString → integer-ish). */
function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** Extract the stated price levels from a verdict envelope — the numbers the answer commits to. */
export function extractStatedNumbers(env: Pick<BieAnswerEnvelope, "levels">): StatedNumber[] {
  const out: StatedNumber[] = [];
  for (const lv of env.levels ?? []) {
    const metric = metricForLevelLabel(lv.label);
    if (metric == null || !Number.isFinite(lv.price)) continue;
    out.push({ metric, value: lv.price, decimals: decimalsOf(lv.price) });
  }
  return out;
}

/**
 * "The stated number equals the served number" — matched iff equal at the STATED number's displayed
 * precision (half-ULP of its decimal places) plus a 0.01 absolute slack. Mirrors the hardcore suite's
 * `citesValue` exactly, so the composition-time gate and the post-hoc e2e agree on what "equal" means.
 */
export function statedMatchesTruth(stated: StatedNumber, truth: number | null | undefined): boolean {
  if (truth == null || !Number.isFinite(Number(truth))) return false;
  const tol = 0.5 * 10 ** -stated.decimals + 0.01;
  return Math.abs(stated.value - Number(truth)) <= tol;
}

export type NumericMismatch = { metric: NumericMetric; stated: number; served: number };

export type NumericGateResult = {
  /** Regular trading hours at gate time → equality is a HARD requirement. */
  rth: boolean;
  /** Metrics whose stated value disagreed with the served value beyond tolerance. */
  mismatches: NumericMismatch[];
  /** Corrected level values keyed by metric — populated only in RTH when a mismatch was found. */
  corrections: Partial<Record<NumericMetric, number>>;
  /** "clean" (all match), "corrected" (RTH mismatch → fixed to served), "stale-marked" (off-hours
   *  mismatch → left as-is but the answer must carry a staleness marker). */
  action: "clean" | "corrected" | "stale-marked";
};

/**
 * Reconcile the numbers a verdict stated against the freshly-served authoritative snapshot. PURE.
 *  - RTH + a mismatch → `corrected`: the served value wins and is returned in `corrections` so the
 *    composer replaces the stale number (never ships a number the API contradicts intraday).
 *  - off-hours + a mismatch → `stale-marked`: the snapshot is a prior-close read; leave the number
 *    but signal that the answer must carry the staleness marker.
 *  - all match → `clean`.
 */
export function reconcileStatedNumbers(
  stated: StatedNumber[],
  truth: NumericTruth,
  now: number = Date.now()
): NumericGateResult {
  const rth = isRegularTradingHoursNow(now);
  const mismatches: NumericMismatch[] = [];
  const corrections: Partial<Record<NumericMetric, number>> = {};

  for (const s of stated) {
    const served = truth[s.metric];
    if (served == null || !Number.isFinite(Number(served))) continue; // nothing authoritative to check
    if (!statedMatchesTruth(s, served)) {
      mismatches.push({ metric: s.metric, stated: s.value, served: Number(served) });
      if (rth) corrections[s.metric] = Number(served);
    }
  }

  const action: NumericGateResult["action"] =
    mismatches.length === 0 ? "clean" : rth ? "corrected" : "stale-marked";
  return { rth, mismatches, corrections, action };
}

/** Apply RTH corrections to a level list — swap each stale stated price for the served value, and
 *  note the correction inline so the fix is visible, not silent. PURE. */
export function applyCorrectionsToLevels(
  levels: BieLevel[] | undefined,
  corrections: Partial<Record<NumericMetric, number>>
): BieLevel[] {
  if (!levels) return [];
  return levels.map((lv) => {
    const metric = metricForLevelLabel(lv.label);
    const served = metric ? corrections[metric] : undefined;
    if (served == null) return lv;
    return {
      ...lv,
      price: served,
      note: [lv.note, `re-synced to live ${served.toLocaleString("en-US", { maximumFractionDigits: 2 })}`]
        .filter(Boolean)
        .join(" · "),
    };
  });
}
