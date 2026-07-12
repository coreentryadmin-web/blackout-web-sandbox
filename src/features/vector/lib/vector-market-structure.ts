/**
 * Market structure for the Vector chart — CTO roadmap #2: swing labels (HH/HL/LH/LL) and structure
 * breaks (BOS / CHOCH) derived from the same fractal pivots the auto-fib uses (vector-fib-swing).
 *
 * Definitions (the standard SMC reading):
 * - Each confirmed pivot HIGH is labelled vs the PREVIOUS pivot high: higher → HH, lower → LH
 *   (equal counts as LH — no higher high was made). Pivot LOWS mirror: HL / LL. The first pivot of
 *   each kind has no predecessor and is labelled plain "H" / "L".
 * - BOS (break of structure): a bar CLOSES beyond the most recent confirmed pivot in the direction
 *   of the prevailing trend — continuation. The very first break also counts as a BOS (it
 *   ESTABLISHES the trend; there is nothing to change character from).
 * - CHOCH (change of character): a bar closes beyond the most recent confirmed pivot AGAINST the
 *   prevailing trend — the early reversal tell. After a CHOCH the trend flips, so the next break
 *   that way is a BOS again.
 *
 * Honesty rules, both load-bearing:
 * - A pivot only becomes tradable knowledge k bars after its extreme (fractal confirmation lag), so
 *   breaks are only evaluated against pivots ALREADY CONFIRMED at that bar — no lookahead: an event
 *   can never cite a pivot the member couldn't have seen at that moment.
 * - CLOSES beyond, not wicks-through: intrabar pokes that close back inside are not structure
 *   breaks, matching how traders actually mark BOS/CHOCH.
 *
 * Pure and dependency-free (bars in → labels/events out); the chart layer maps these to markers.
 */

import { detectPivots, type SwingBar } from "./vector-fib-swing";

export type StructureBar = SwingBar & { close: number };

export type PivotLabel = "HH" | "LH" | "HL" | "LL" | "H" | "L";

export type LabeledPivot = {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
  label: PivotLabel;
};

export type StructureEvent = {
  /** Bar index / time where the CLOSE broke the level (not where the pivot printed). */
  index: number;
  time: number;
  /** The broken pivot's price — the level the close crossed. */
  level: number;
  type: "BOS" | "CHOCH";
  direction: "up" | "down";
};

/** Fractal pivots labelled HH/LH/HL/LL vs their same-kind predecessor, in chronological order. */
export function labelPivots(bars: readonly StructureBar[], k: number): LabeledPivot[] {
  const { highs, lows } = detectPivots(bars, k);
  const merged: LabeledPivot[] = [
    ...highs.map((p) => ({ ...p, kind: "high" as const, label: "H" as PivotLabel })),
    ...lows.map((p) => ({ ...p, kind: "low" as const, label: "L" as PivotLabel })),
  ].sort((a, b) => a.index - b.index);
  let prevHigh: number | null = null;
  let prevLow: number | null = null;
  for (const p of merged) {
    if (p.kind === "high") {
      if (prevHigh != null) p.label = p.price > prevHigh ? "HH" : "LH";
      prevHigh = p.price;
    } else {
      if (prevLow != null) p.label = p.price > prevLow ? "HL" : "LL";
      prevLow = p.price;
    }
  }
  return merged;
}

/**
 * BOS/CHOCH events from closes crossing confirmed pivots. Each pivot can be broken at most once
 * (the first close beyond it) — later bars beyond the same dead level are trend continuation, not
 * new structure. Trend starts undefined; the first break establishes it as a BOS.
 */
export function detectStructureEvents(
  bars: readonly StructureBar[],
  k: number
): StructureEvent[] {
  const pivots = labelPivots(bars, k);
  const events: StructureEvent[] = [];
  let trend: "up" | "down" | null = null;
  // The most recent UNBROKEN confirmed pivot per side, updated as the scan advances.
  let activeHigh: LabeledPivot | null = null;
  let activeLow: LabeledPivot | null = null;
  let nextPivot = 0;

  for (let j = 0; j < bars.length; j++) {
    // Admit pivots as they become KNOWN (index + k ≤ current bar) — the no-lookahead rule.
    while (nextPivot < pivots.length && pivots[nextPivot]!.index + k <= j) {
      const p = pivots[nextPivot++]!;
      if (p.kind === "high") activeHigh = p;
      else activeLow = p;
    }
    const close = bars[j]!.close;
    if (activeHigh && close > activeHigh.price) {
      events.push({
        index: j,
        time: bars[j]!.time,
        level: activeHigh.price,
        type: trend === "down" ? "CHOCH" : "BOS",
        direction: "up",
      });
      trend = "up";
      activeHigh = null; // a level breaks once
    }
    if (activeLow && close < activeLow.price) {
      events.push({
        index: j,
        time: bars[j]!.time,
        level: activeLow.price,
        type: trend === "up" ? "CHOCH" : "BOS",
        direction: "down",
      });
      trend = "down";
      activeLow = null;
    }
  }
  return events;
}
