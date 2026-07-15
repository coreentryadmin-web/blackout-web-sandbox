/**
 * SHARED PRICE AXIS strike ladder (SPX desk, 2026-07-13) — pure row-building math for the
 * middle-column ladder that renders the dealer-gamma matrix's strikes on the SAME y-scale
 * as the adjacent Vector chart (VectorPriceScaleMap seam). Kept dependency-free so it is
 * unit-testable via `tsx --test`; the component only measures DOM and paints these rows.
 */

import { linearPriceToY } from "@/features/vector/lib/vector-price-scale-map";

export type LadderScale = {
  /** Price at the bottom / top edge of the axis. */
  rangeMin: number;
  rangeMax: number;
  /** Axis height in px. */
  height: number;
  /** Chart-native mapping when available (preferred); falls back to linear. */
  priceToY?: (price: number) => number | null;
};

export type LadderAxisRow = {
  strike: number;
  /** Signed net exposure at this strike (the matrix's Net column source). */
  net: number;
  /** px from the TOP of the axis (pane-relative — the host applies its own offset). */
  y: number;
  /** Bar length as % of the half-width available on the bar's side (0..100). */
  widthPct: number;
  king: boolean;
  callWall: boolean;
  putWall: boolean;
  /** Density gate: draw the strike label only when rows don't collide (or the row matters). */
  label: boolean;
};

/** Resolve a price to axis-y: chart-native first, exact-linear fallback. */
export function ladderY(scale: LadderScale, price: number): number | null {
  const native = scale.priceToY?.(price);
  if (native != null && Number.isFinite(native)) return native;
  return linearPriceToY(scale.rangeMin, scale.rangeMax, scale.height)(price);
}

/**
 * Fallback visible range when no chart map exists yet (chart still mounting, or the
 * vector column is gated off): a ±padPct window around spot, widened if needed to cover
 * at least a few strikes; strike min/max when there is no spot at all.
 */
export function fallbackLadderRange(
  spot: number | null,
  strikes: readonly number[],
  padPct = 0.012
): { rangeMin: number; rangeMax: number } | null {
  if (spot != null && spot > 0) {
    const pad = spot * padPct;
    return { rangeMin: spot - pad, rangeMax: spot + pad };
  }
  if (strikes.length >= 2) {
    const min = Math.min(...strikes);
    const max = Math.max(...strikes);
    if (max > min) return { rangeMin: min, rangeMax: max };
  }
  return null;
}

/** Bar thickness for a given vertical gap between adjacent strike rows. */
export function ladderBarThickness(rowGapPx: number): number {
  if (!Number.isFinite(rowGapPx) || rowGapPx <= 0) return 2;
  return Math.max(2, Math.min(9, Math.round(rowGapPx * 0.55)));
}

export type BuildLadderArgs = {
  strikes: readonly number[];
  /** strike → signed net exposure (the matrix block's strike_totals). */
  totals: Record<string, number>;
  scale: LadderScale;
  king: number | null;
  callWall: number | null;
  putWall: number | null;
  /** Rows closer together than this only get labels when they're king/wall rows. */
  minLabelGapPx?: number;
};

/**
 * Build the ladder rows: strikes inside the visible price range, positioned by the shared
 * scale, bar lengths normalised to the largest |net| among the VISIBLE rows (so the rail
 * always uses its full width for the structure actually on screen — same normalisation
 * the matrix's cell shading uses via its `peak`).
 */
export function buildLadderAxisRows(args: BuildLadderArgs): LadderAxisRow[] {
  const { strikes, totals, scale, king, callWall, putWall } = args;
  const minLabelGapPx = args.minLabelGapPx ?? 12;
  if (!(scale.height > 0) || !(scale.rangeMax > scale.rangeMin)) return [];

  type Draft = Omit<LadderAxisRow, "widthPct" | "label">;
  const drafts: Draft[] = [];
  for (const strike of strikes) {
    if (!Number.isFinite(strike)) continue;
    if (strike < scale.rangeMin || strike > scale.rangeMax) continue;
    const y = ladderY(scale, strike);
    if (y == null || y < 0 || y > scale.height) continue;
    const raw = totals[String(strike)];
    const net = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    drafts.push({
      strike,
      net,
      y,
      king: king != null && strike === king,
      callWall: callWall != null && strike === callWall,
      putWall: putWall != null && strike === putWall,
    });
  }
  // Top of the pane first (highest strike first) — matches the table's ordering.
  drafts.sort((a, b) => a.y - b.y);

  let peak = 0;
  for (const d of drafts) peak = Math.max(peak, Math.abs(d.net));

  return drafts.map((d, i) => {
    const gapUp = i > 0 ? d.y - drafts[i - 1]!.y : Number.POSITIVE_INFINITY;
    const gapDown = i < drafts.length - 1 ? drafts[i + 1]!.y - d.y : Number.POSITIVE_INFINITY;
    const spaced = Math.min(gapUp, gapDown) >= minLabelGapPx;
    return {
      ...d,
      widthPct: peak > 0 ? (Math.abs(d.net) / peak) * 100 : 0,
      label: spaced || d.king || d.callWall || d.putWall,
    };
  });
}

/** Median pixel gap between adjacent rows — drives bar thickness. */
export function ladderRowGapPx(rows: readonly LadderAxisRow[]): number {
  if (rows.length < 2) return 12;
  const gaps = rows
    .slice(1)
    .map((r, i) => r.y - rows[i]!.y)
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 12;
}
