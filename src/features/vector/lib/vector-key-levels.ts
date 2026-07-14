/**
 * Key price levels + Fibonacci for the Vector chart's opt-in "Levels" overlays. Pure, dependency-
 * free geometry over the session bars — each toggle maps to one or more horizontal price lines the
 * chart draws (like the king anchor), NOT a per-bar series. Kept out of the component so the level
 * math is unit-tested directly.
 *
 * Session levels (HOD/LOD, opening range, Fib of the HOD→LOD swing) come from the CURRENT bars
 * alone. Prior-day levels (PDH/PDL/PDC) and floor pivots need the prior session's OHLC, passed in
 * as `priorDay` (fetched once by the chart) — still pure here.
 */

import type { VectorLevelId } from "./vector-indicators-config";
import { dominantSwing, swingRetracement } from "./vector-fib-swing";

export type LevelBar = { time: number; high: number; low: number; close: number };

/** Prior-session OHLC extremes the prior-day/pivot levels are derived from. */
export type PriorDayOhlc = { pdh: number; pdl: number; pdc: number };

/** A single horizontal level line the chart draws. */
export type LevelLine = {
  /** Stable key so the chart can diff/keep/remove price lines across repaints. */
  key: string;
  price: number;
  label: string;
  color: string;
  style: "solid" | "dashed" | "dotted";
};

const HOD_COLOR = "#34d399"; // green — high of day
const LOD_COLOR = "#f87171"; // red — low of day
const OR_COLOR = "#a78bfa"; // violet — opening range
const FIB_SWING_COLOR = "#94a3b8"; // slate — the 0%/100% swing bounds
const FIB_KEY_COLOR = "#a78bfa"; // violet — the respected 38.2/50/78.6 levels
const FIB_DIM_COLOR = "#64748b"; // dim slate — the weak 23.6 level
const FIB_GOLDEN_COLOR = "#ffd60a"; // gold — the 61.8% "golden ratio", the highest-probability level

/** Standard Fibonacci retracement ratios (0 and 1 included as the swing bounds). */
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/**
 * Per-ratio visual weight, mirroring the importance hierarchy traders use: the 61.8% golden ratio
 * is the marquee level (gold, solid), 38.2/50/78.6 are the respected mid levels (violet, dashed),
 * 23.6 is weak (dim, dotted), and 0/100 are the swing bounds (slate, solid).
 */
function fibStyle(ratio: number): { color: string; style: LevelLine["style"]; label: string } {
  if (ratio === 0) return { color: FIB_SWING_COLOR, style: "solid", label: "Fib 0% · HOD" };
  if (ratio === 1) return { color: FIB_SWING_COLOR, style: "solid", label: "Fib 100% · LOD" };
  if (ratio === 0.618)
    return { color: FIB_GOLDEN_COLOR, style: "solid", label: "Fib 61.8% · golden" };
  if (ratio === 0.236) return { color: FIB_DIM_COLOR, style: "dotted", label: "Fib 23.6%" };
  return { color: FIB_KEY_COLOR, style: "dashed", label: `Fib ${(ratio * 100).toFixed(1)}%` };
}

/** High/low of the whole session, or null when there are no bars. */
export function sessionHodLod(bars: LevelBar[]): { hod: number; lod: number } | null {
  if (!bars.length) return null;
  let hod = -Infinity;
  let lod = Infinity;
  for (const b of bars) {
    if (Number.isFinite(b.high) && b.high > hod) hod = b.high;
    if (Number.isFinite(b.low) && b.low < lod) lod = b.low;
  }
  if (!Number.isFinite(hod) || !Number.isFinite(lod)) return null;
  return { hod, lod };
}

/**
 * High/low of the opening range — the first `minutes` of the session, measured from the FIRST
 * bar's time (bars are epoch seconds). Bars exactly at `firstTime + minutes*60` are excluded (the
 * range is half-open), matching how the interval buckets elsewhere. Null when no bar falls in it.
 */
export function openingRange(
  bars: LevelBar[],
  minutes: number
): { high: number; low: number } | null {
  if (!bars.length || minutes <= 0) return null;
  const start = bars[0]!.time;
  const end = start + minutes * 60;
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (b.time >= end) break; // bars are ascending by time
    if (Number.isFinite(b.high) && b.high > high) high = b.high;
    if (Number.isFinite(b.low) && b.low < low) low = b.low;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high, low };
}

/**
 * Fibonacci retracement prices for a swing between `high` and `low`. Price at ratio r is measured
 * DOWN from the high: `high - r*(high-low)`, so 0% = high, 100% = low, 61.8% = the classic golden
 * retracement. Returns [] for a degenerate (zero or inverted) range.
 */
export function fibLevels(high: number, low: number): Array<{ ratio: number; price: number }> {
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return [];
  const range = high - low;
  return FIB_RATIOS.map((ratio) => ({ ratio, price: high - ratio * range }));
}

const PD_COLOR = "#38bdf8"; // sky — prior-day high/low/close
// orange-500 — deliberately NOT #fb923c (EMA 9's orange-400): two different indicators sharing an
// exact color made them indistinguishable on the chart (and made pixel-level E2E color checks
// collide — EMA-off "residue" was really the pivot P line).
const PIVOT_P_COLOR = "#f97316";
const PIVOT_R_COLOR = "#f87171"; // red — resistance pivots (above P)
const PIVOT_S_COLOR = "#34d399"; // green — support pivots (below P)

export type FloorPivots = {
  p: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};

/**
 * Classic floor-trader pivots from the prior session's H/L/C. P is the fulcrum; R1–R3 / S1–S3 are
 * the standard resistance/support projections. Returns null on non-finite input.
 */
export function floorPivots(pdh: number, pdl: number, pdc: number): FloorPivots | null {
  if (![pdh, pdl, pdc].every(Number.isFinite)) return null;
  const p = (pdh + pdl + pdc) / 3;
  const range = pdh - pdl;
  return {
    p,
    r1: 2 * p - pdl,
    s1: 2 * p - pdh,
    r2: p + range,
    s2: p - range,
    r3: pdh + 2 * (p - pdl),
    s3: pdl - 2 * (pdh - p),
  };
}

/**
 * Compose the draw-ready horizontal lines for one enabled level group. Session groups use `bars`;
 * the prior-day / pivot groups use `priorDay` (the prior session's OHLC the chart fetched). Returns
 * [] when the group can't be computed (no bars / degenerate range / prior-day not loaded yet), so
 * the caller simply draws nothing rather than a bogus line.
 */
export function levelLinesFor(
  id: VectorLevelId,
  bars: LevelBar[],
  priorDay?: PriorDayOhlc | null
): LevelLine[] {
  if (id === "hod-lod") {
    const hl = sessionHodLod(bars);
    if (!hl) return [];
    return [
      { key: "hod", price: hl.hod, label: "HOD", color: HOD_COLOR, style: "solid" },
      { key: "lod", price: hl.lod, label: "LOD", color: LOD_COLOR, style: "solid" },
    ];
  }
  if (id === "opening-range") {
    const or = openingRange(bars, 15);
    if (!or) return [];
    return [
      { key: "or-high", price: or.high, label: "OR-H 15m", color: OR_COLOR, style: "dashed" },
      { key: "or-low", price: or.low, label: "OR-L 15m", color: OR_COLOR, style: "dashed" },
    ];
  }
  if (id === "fib") {
    const hl = sessionHodLod(bars);
    if (!hl) return [];
    return fibLevels(hl.hod, hl.lod).map((f) => {
      const s = fibStyle(f.ratio);
      return { key: `fib-${f.ratio}`, price: f.price, label: s.label, color: s.color, style: s.style };
    });
  }
  if (id === "fib-auto") {
    // Auto-swing fib (CTO#1): retrace the DOMINANT swing of the DISPLAYED bars (the largest recent
    // impulse, not the last noise wiggle) — so it re-detects per timeframe — with the 61.8–65%
    // golden pocket as the marquee zone. A 0.15%-of-price floor means we draw NOTHING until a
    // genuine swing exists rather than a hairline pocket clinging to spot. Every line is labelled
    // by what it IS (swing high/low, the exact fib ratios) so there are no duplicate labels.
    const ref = bars.length ? bars[bars.length - 1]!.close : 0;
    const swing = dominantSwing(bars, 3, ref > 0 ? ref * 0.0015 : 0);
    if (!swing) return [];
    return [
      { key: "afib-high", price: swing.high, label: `Swing high ${swing.high}`, color: FIB_SWING_COLOR, style: "solid" },
      { key: "afib-50", price: swingRetracement(swing, 0.5), label: "Fib 50%", color: FIB_KEY_COLOR, style: "dashed" },
      // The golden pocket = the 61.8%→65% band; each bound labelled by its own ratio.
      { key: "afib-gp618", price: swingRetracement(swing, 0.618), label: "Golden pocket 61.8%", color: FIB_GOLDEN_COLOR, style: "solid" },
      { key: "afib-gp65", price: swingRetracement(swing, 0.65), label: "Golden pocket 65%", color: FIB_GOLDEN_COLOR, style: "dashed" },
      { key: "afib-low", price: swing.low, label: `Swing low ${swing.low}`, color: FIB_SWING_COLOR, style: "solid" },
    ];
  }
  if (id === "pdh-pdl-pdc") {
    if (!priorDay) return [];
    const { pdh, pdl, pdc } = priorDay;
    if (![pdh, pdl, pdc].every(Number.isFinite)) return [];
    return [
      { key: "pdh", price: pdh, label: "PDH", color: PD_COLOR, style: "dashed" },
      { key: "pdc", price: pdc, label: "PDC", color: PD_COLOR, style: "solid" },
      { key: "pdl", price: pdl, label: "PDL", color: PD_COLOR, style: "dashed" },
    ];
  }
  // pivots
  if (!priorDay) return [];
  const piv = floorPivots(priorDay.pdh, priorDay.pdl, priorDay.pdc);
  if (!piv) return [];
  return [
    { key: "piv-p", price: piv.p, label: "Pivot", color: PIVOT_P_COLOR, style: "solid" },
    { key: "piv-r1", price: piv.r1, label: "R1", color: PIVOT_R_COLOR, style: "dashed" },
    { key: "piv-r2", price: piv.r2, label: "R2", color: PIVOT_R_COLOR, style: "dotted" },
    { key: "piv-r3", price: piv.r3, label: "R3", color: PIVOT_R_COLOR, style: "dotted" },
    { key: "piv-s1", price: piv.s1, label: "S1", color: PIVOT_S_COLOR, style: "dashed" },
    { key: "piv-s2", price: piv.s2, label: "S2", color: PIVOT_S_COLOR, style: "dotted" },
    { key: "piv-s3", price: piv.s3, label: "S3", color: PIVOT_S_COLOR, style: "dotted" },
  ];
}
