import type { LineWidth } from "lightweight-charts";

/** Faint floor so a weak wall is a ghost, not a peer of the session king (Skylit-style
 *  high contrast). Was 0.12 — too bright, which washed every rail to the same weight. */
const ALPHA_MIN = 0.05;
const ALPHA_MAX = 1;
const WIDTH_MIN: LineWidth = 1;
const WIDTH_MAX: LineWidth = 4;
/** Slightly larger beads — reference product reads chunky on mobile, not pinpoints. */
const RADIUS_MIN = 2;
const RADIUS_MAX = 6;
/** createSeriesMarkers `size` — per-bead, unlike LineSeries pointMarkersRadius (series-wide). */
const MARKER_SIZE_MIN = 0.5;
const MARKER_SIZE_MAX = 2.8;

/** A wall at/above this share of total |gamma| renders at full visual weight (alpha 1, max size).
 *  Real per-strike GEX share tops out around 6–8% even for the session king (gamma is spread across
 *  ~20 strikes), so the saturation point must sit in that range — a 12% ceiling meant the strongest
 *  wall never reached full boldness. */
const PCT_SATURATION = 7;

function magnitudeT(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  // Slightly SUPER-linear (exp > 1) so the strength ratio is PRESERVED, not compressed:
  // the old sqrt (0.55) flattened an 8:1 real-strength ratio to ~3:1, making a dominant
  // wall look barely bolder than a weak one. At 1.15 an 8%-vs-1% wall reads ~9:1 — bold
  // king, faint stragglers, matching how Skylit renders dealer walls.
  return Math.pow(Math.min(1, pct / PCT_SATURATION), 1.15);
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

/**
 * Alpha multiplier for MODELED (reconstructed) beads vs OBSERVED (recorded) ones. Modeled beads
 * render at 40% of the observed alpha — dim enough to read as a "ghosted/modeled" underlay that
 * is clearly secondary to the solid recorded beads, without disappearing entirely. Honesty is the
 * whole point (modeled ≠ observed must be visible); a single dim/shrink pass keeps the marker
 * plugin simple (no second shape) while still separating the two visually. Kept as one shared
 * constant so the core bead, its glow halo, and the legend all agree on "dim = modeled."
 */
export const MODELED_ALPHA_SCALE = 0.4;
