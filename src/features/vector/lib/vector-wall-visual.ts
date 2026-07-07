import type { LineWidth } from "lightweight-charts";

const ALPHA_MIN = 0.12;
const ALPHA_MAX = 1;
const WIDTH_MIN: LineWidth = 1;
const WIDTH_MAX: LineWidth = 4;
/** Slightly larger beads — reference product reads chunky on mobile, not pinpoints. */
const RADIUS_MIN = 2;
const RADIUS_MAX = 6;
/** createSeriesMarkers `size` — per-bead, unlike LineSeries pointMarkersRadius (series-wide). */
const MARKER_SIZE_MIN = 0.55;
const MARKER_SIZE_MAX = 2.35;

/** A wall at/above this share of total |gamma| renders at full visual weight (alpha 1, max size).
 *  Tuned below the old 20% ceiling so dominant walls pop without every top strike saturating. */
const PCT_SATURATION = 12;

function magnitudeT(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  // Sqrt curve — mid-tier walls read visibly weaker than the session king.
  return Math.pow(Math.min(1, pct / PCT_SATURATION), 0.55);
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

/** Historical trail dot radius, scaled the same way — legacy LineSeries fallback only. */
export function radiusForPct(pct: number): number {
  return RADIUS_MIN + magnitudeT(pct) * (RADIUS_MAX - RADIUS_MIN);
}

/** Per-bead marker size for createSeriesMarkers — each dot can be its own weight (Skylit-style). */
export function markerSizeForPct(pct: number): number {
  return MARKER_SIZE_MIN + magnitudeT(pct) * (MARKER_SIZE_MAX - MARKER_SIZE_MIN);
}

/** Halo opacity multiplier for the outer glow ring drawn behind each bead. */
export function glowAlphaForPct(pct: number): number {
  return alphaForPct(pct) * (0.22 + magnitudeT(pct) * 0.18);
}
