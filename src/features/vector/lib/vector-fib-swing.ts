/**
 * Auto-swing Fibonacci + golden pocket for the Vector chart — CTO roadmap #1.
 *
 * The existing "fib" level retraces the whole session's HOD→LOD, which is honest but blunt: traders
 * retrace the LAST SIGNIFICANT SWING, not the day's extremes, and they watch the "golden pocket"
 * (the 61.8%–65% retracement zone) as the highest-probability reaction area. This module detects
 * that swing mechanically and derives the retracement + pocket from it.
 *
 * Pure and dependency-free (bars in → numbers out, no clock/network) so the swing logic is
 * unit-tested directly; the chart layer maps the output to price lines like every other level.
 *
 * Swing detection uses standard fractal pivots: a pivot HIGH is a bar whose high is the strict
 * maximum of the `k` bars on each side (ties break to the earlier bar so a flat top yields one
 * pivot, not many); pivot LOW mirrors. The most recent pivot high H and pivot low L define the
 * swing: whichever came FIRST is the origin, the later one the terminus — H before L is a DOWN
 * swing (retracement bounces up from L), L before H is an UP swing (retracement pulls back down
 * from H). Retracement price at ratio r is measured from the terminus back toward the origin:
 *   up-swing:   price = high − r·range   (0% = the swing high, 100% = the swing low)
 *   down-swing: price = low  + r·range
 * which matches the classic TradingView convention for each direction.
 */

export type SwingBar = { time: number; high: number; low: number };

export type SwingPoint = { index: number; time: number; price: number };

export type Swing = {
  /** Chronological origin of the move. */
  from: SwingPoint;
  /** Terminus of the move (the more recent pivot). */
  to: SwingPoint;
  direction: "up" | "down";
  high: number;
  low: number;
};

/** The golden-pocket bounds (61.8%–65% retracement) — the zone, not a single line. */
export const GOLDEN_POCKET_RATIOS = [0.618, 0.65] as const;

/**
 * Fractal pivot detection: index i is a pivot high iff bars[i].high is the strict max of the
 * window [i−k, i+k] (ties resolve to the earliest bar). The last k bars can't confirm a pivot yet
 * (their right side is incomplete) — that lag is inherent to fractals and honest: a swing isn't a
 * swing until price has actually turned away from it.
 */
export function detectPivots(
  bars: readonly SwingBar[],
  k: number
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  if (k <= 0 || bars.length < 2 * k + 1) return { highs, lows };
  for (let i = k; i < bars.length - k; i++) {
    const b = bars[i]!;
    let isHigh = Number.isFinite(b.high);
    let isLow = Number.isFinite(b.low);
    for (let j = i - k; j <= i + k && (isHigh || isLow); j++) {
      if (j === i) continue;
      const o = bars[j]!;
      // Ties DISQUALIFY on the left and are ALLOWED on the right → a flat extreme crowns its FIRST
      // bar only (the later equal bar sees an equal-or-better bar to its left and is rejected).
      if (isHigh && (j < i ? o.high >= b.high : o.high > b.high)) isHigh = false;
      if (isLow && (j < i ? o.low <= b.low : o.low < b.low)) isLow = false;
    }
    if (isHigh) highs.push({ index: i, time: b.time, price: b.high });
    if (isLow) lows.push({ index: i, time: b.time, price: b.low });
  }
  return { highs, lows };
}

/**
 * The most recent completed swing: the last pivot high and last pivot low, ordered chronologically.
 * Null when either side lacks a pivot (not enough structure yet) or the two coincide degenerate
 * (equal prices — no range to retrace).
 */
export function latestSwing(bars: readonly SwingBar[], k: number): Swing | null {
  const { highs, lows } = detectPivots(bars, k);
  if (!highs.length || !lows.length) return null;
  const h = highs[highs.length - 1]!;
  const l = lows[lows.length - 1]!;
  if (h.price <= l.price) return null; // degenerate/crossed — no honest retracement
  const [from, to] = h.index <= l.index ? [h, l] : [l, h];
  return {
    from,
    to,
    direction: h.index <= l.index ? "down" : "up",
    high: h.price,
    low: l.price,
  };
}

/**
 * The DOMINANT recent swing — the single largest-range leg between adjacent (opposite-kind) fractal
 * pivots in the displayed window, subject to a `minRange` floor. This is what auto-fib should
 * retrace: `latestSwing` above takes the *last* pivot pair, which on a 1-minute chart is usually
 * noise (a 0.1-point wiggle) — the pocket then collapses to a hairline near spot. Picking the
 * biggest leg instead surfaces the real impulse traders actually retrace, and the floor means we
 * draw NOTHING until a genuine swing exists (honest, not a hairline). Ties resolve to the more
 * recent leg. Null when no opposite-kind adjacent leg clears `minRange`.
 */
export function dominantSwing(bars: readonly SwingBar[], k: number, minRange = 0): Swing | null {
  const { highs, lows } = detectPivots(bars, k);
  const merged = [
    ...highs.map((p) => ({ ...p, kind: "high" as const })),
    ...lows.map((p) => ({ ...p, kind: "low" as const })),
  ].sort((a, b) => a.index - b.index);
  if (merged.length < 2) return null;

  let best: { hi: SwingPoint; lo: SwingPoint; down: boolean; range: number } | null = null;
  for (let i = 0; i < merged.length - 1; i++) {
    const a = merged[i]!;
    const b = merged[i + 1]!;
    if (a.kind === b.kind) continue; // need an up-or-down leg, not two same-side pivots
    const range = Math.abs(a.price - b.price);
    if (range < minRange || range <= 0) continue;
    const hi = a.kind === "high" ? a : b;
    const lo = a.kind === "high" ? b : a;
    // ">=" so a later leg of equal size wins the tie (prefer recency).
    if (!best || range >= best.range) best = { hi, lo, down: hi.index < lo.index, range };
  }
  if (!best) return null;
  const strip = (p: SwingPoint) => ({ index: p.index, time: p.time, price: p.price });
  const [from, to] = best.down ? [best.hi, best.lo] : [best.lo, best.hi];
  return { from: strip(from), to: strip(to), direction: best.down ? "down" : "up", high: best.hi.price, low: best.lo.price };
}

/**
 * Retracement price at `ratio` for a swing, measured from the terminus back toward the origin —
 * 0% is the end of the move, 100% fully retraces it (see module doc for the per-direction form).
 */
export function swingRetracement(swing: Swing, ratio: number): number {
  const range = swing.high - swing.low;
  return swing.direction === "up" ? swing.high - ratio * range : swing.low + ratio * range;
}

/**
 * The golden pocket for a swing — the [61.8%, 65%] retracement zone, returned low-to-high in PRICE
 * so the chart can draw the band without caring about direction.
 */
export function goldenPocket(swing: Swing): { top: number; bottom: number } {
  const a = swingRetracement(swing, GOLDEN_POCKET_RATIOS[0]);
  const b = swingRetracement(swing, GOLDEN_POCKET_RATIOS[1]);
  return { top: Math.max(a, b), bottom: Math.min(a, b) };
}
