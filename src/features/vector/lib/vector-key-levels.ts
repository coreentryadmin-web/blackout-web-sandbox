/**
 * Key price levels + Fibonacci for the Vector chart's opt-in "Levels" overlays. Pure, dependency-
 * free geometry over the session bars — each toggle maps to one or more horizontal price lines the
 * chart draws (like the king anchor), NOT a per-bar series. Kept out of the component so the level
 * math is unit-tested directly.
 *
 * This first slice covers the levels derivable from the CURRENT session's bars alone (no extra
 * data): high/low of day, the opening range, and a Fibonacci retracement of the HOD→LOD swing.
 * Prior-day levels (PDH/PDL/PDC) + floor pivots need a prior-session OHLC fetch and land next.
 */

export type LevelBar = { time: number; high: number; low: number; close: number };

/** A single horizontal level line the chart draws. */
export type LevelLine = {
  /** Stable key so the chart can diff/keep/remove price lines across repaints. */
  key: string;
  price: number;
  label: string;
  color: string;
  style: "solid" | "dashed" | "dotted";
};

/** The toggleable level groups. */
export type VectorLevelId = "hod-lod" | "opening-range" | "fib";

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

/**
 * Compose the draw-ready horizontal lines for one enabled level group against the session bars.
 * Returns [] when the group can't be computed (no bars / degenerate range) so the caller simply
 * draws nothing rather than a bogus line.
 */
export function levelLinesFor(id: VectorLevelId, bars: LevelBar[]): LevelLine[] {
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
  // fib
  const hl = sessionHodLod(bars);
  if (!hl) return [];
  return fibLevels(hl.hod, hl.lod).map((f) => {
    const s = fibStyle(f.ratio);
    return { key: `fib-${f.ratio}`, price: f.price, label: s.label, color: s.color, style: s.style };
  });
}
