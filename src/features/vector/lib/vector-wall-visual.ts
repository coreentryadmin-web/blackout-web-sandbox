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
/** createSeriesMarkers `size` — per-bead, unlike LineSeries pointMarkersRadius (series-wide).
 *  Range widened from [0.5, 3.4] → [0.3, 5.5] so a king wall is unmistakably fatter than a
 *  straggler, and temporal magnitude changes (a wall fading from 30% to 5% over the session)
 *  produce a visibly tapering trail — the "shrinking beads" cue that tells you at a glance
 *  when dealers are unwinding a wall vs building one up. */
const MARKER_SIZE_MIN = 0.3;
const MARKER_SIZE_MAX = 5.5;

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

// ── RELATIVE (frame-normalized) bead strength ──────────────────────────────────────────────
//
// The absolute magnitudeT above saturates at a FIXED PCT_SATURATION (7%). That's right for the
// UW oracle ladder, where gamma spreads across ~20 strikes so even the session king is only
// ~6-8%. But the per-expiry Polygon-chain path (banded, far fewer strikes) concentrates gamma
// into 20-40% on a SINGLE strike — so on stocks EVERY top wall clears 7% and clips to max size,
// and they all render at identical thickness. That is the "all our beads look the same" report:
// a 41% wall and a 14% wall were drawn the same fat because both saturated.
//
// The fix: for the bead rail, scale each bead against the STRONGEST wall currently in view
// (`maxPct`) instead of a fixed absolute cap. The dominant wall is always the reference (t=1,
// full weight); everything scales down from it — the Skylit fat-king / thin-straggler contrast,
// preserved at any absolute concentration (6% SPX or 40% AMD alike).

/** Contrast exponent for relative strength. >1 widens the gap so a half-strength wall reads
 *  clearly thinner than the king rather than nearly as fat. Raised from 1.4 → 2.0 so a wall
 *  at half the king's magnitude renders at 25% weight (not 38%) — the size gap between a king
 *  and a fading wall is obvious at a glance rather than a subtle difference you have to squint
 *  at, and a wall that builds up over the session visibly fattens its trail. */
const REL_CONTRAST_EXP = 2.0;

/** Frame-normalized strength in [0,1]: `pct` relative to the strongest wall in view (`maxPct`),
 *  raised to REL_CONTRAST_EXP for separation. 0 for non-positive/non-finite input or maxPct ≤ 0. */
export function relStrengthT(pct: number, maxPct: number): number {
  if (!Number.isFinite(pct) || pct <= 0 || !(maxPct > 0)) return 0;
  return Math.pow(Math.min(1, pct / maxPct), REL_CONTRAST_EXP);
}

/** Per-bead size relative to the frame's strongest wall (the Skylit-contrast bead path). */
export function markerSizeForPctRel(pct: number, maxPct: number): number {
  return MARKER_SIZE_MIN + relStrengthT(pct, maxPct) * (MARKER_SIZE_MAX - MARKER_SIZE_MIN);
}

/** Per-bead core opacity relative to the frame's strongest wall. */
export function alphaForPctRel(pct: number, maxPct: number): number {
  return ALPHA_MIN + relStrengthT(pct, maxPct) * (ALPHA_MAX - ALPHA_MIN);
}

/** Per-bead halo opacity relative to the frame's strongest wall (glow grows with strength). */
export function glowAlphaForPctRel(pct: number, maxPct: number): number {
  const t = relStrengthT(pct, maxPct);
  return (ALPHA_MIN + t * (ALPHA_MAX - ALPHA_MIN)) * (0.22 + t * 0.18);
}

/**
 * Alpha multiplier for MODELED (reconstructed) beads vs OBSERVED (recorded) ones. Modeled beads
 * must read as a FAINT GHOST underlay — clearly secondary to solid recorded beads and to the
 * candles — not a competing wall. The first pass used 0.4, but a 30%-share wall at 0.4 alpha still
 * renders as a bright, solid full-width row (verified live on AMZN/TSLA: the modeled reconstruction
 * back-projects the closing chain across every bucket → full-width rows, and at 0.4 they looked
 * indistinguishable from observed walls — re-creating the "axis-to-axis walls" the modeled underlay
 * was supposed to visually disown). 0.15 makes even the session-king strike a quiet ghost, so the
 * moment a real observed sample overwrites it the solid bead is unmistakably "more real."
 * Honesty is the whole point: modeled ≠ observed must be visible at a glance.
 */
export const MODELED_ALPHA_SCALE = 0.15;
