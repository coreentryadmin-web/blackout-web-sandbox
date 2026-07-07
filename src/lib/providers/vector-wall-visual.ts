import type { LineWidth } from "lightweight-charts";

const ALPHA_MIN = 0.25;
const ALPHA_MAX = 1;
const WIDTH_MIN: LineWidth = 1;
const WIDTH_MAX: LineWidth = 4;
/** Slightly larger beads — reference product reads chunky on mobile, not pinpoints. */
const RADIUS_MIN = 2;
const RADIUS_MAX = 5;

/** A wall at/above this share of total |gamma| renders at full visual weight (alpha 1, width 4).
 *  Picked from observed live ladders (screenshotted single-strike walls run ~3-10%, occasionally
 *  higher) — 20% is comfortably above what a normal session produces, so saturation is reserved
 *  for a genuinely dominant strike rather than being hit on every ordinary tick. */
const PCT_SATURATION = 20;

function magnitudeT(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(1, pct / PCT_SATURATION);
}

/** Node opacity scaled by the wall's CURRENT share of total |gamma| — not its rank slot — so a
 *  wall that's actually built up in size reads as visually heavier, and a rank-1 wall barely
 *  ahead of rank-2 looks nearly as faint/strong as its neighbor rather than getting an
 *  artificially large opacity jump just for being first. */
export function alphaForPct(pct: number): number {
  return ALPHA_MIN + magnitudeT(pct) * (ALPHA_MAX - ALPHA_MIN);
}

/** Line thickness scaled the same way as alphaForPct, snapped to lightweight-charts' LineWidth
 *  union (1|2|3|4 — it rejects any other integer). */
export function widthForPct(pct: number): LineWidth {
  const raw = Math.round(WIDTH_MIN + magnitudeT(pct) * (WIDTH_MAX - WIDTH_MIN));
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, raw)) as LineWidth;
}

/** Historical trail dot radius, scaled the same way — unlike lineWidth/color this isn't
 *  per-point in lightweight-charts (pointMarkersRadius is a series-level option), so it's
 *  reapplied to the whole trail series each tick and reflects that rank's CURRENT magnitude,
 *  not each individual historical point's own. Per-point color (see VectorChart.tsx) is what
 *  actually varies point-by-point across the trail. */
export function radiusForPct(pct: number): number {
  return RADIUS_MIN + magnitudeT(pct) * (RADIUS_MAX - RADIUS_MIN);
}
