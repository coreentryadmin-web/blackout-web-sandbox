import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";

/** Per-tick volatility context — normalize distance thresholds across session types. */
export type VolatilityContext = {
  vix: number;
  vix_scale: number;
  or_width_pts: number | null;
  or_scale: number;
  atr_proxy_pts: number;
  session_range_pts: number | null;
  /** Multiply a calm-day base distance (e.g. 10 pts) by this for runtime thresholds. */
  distance_scale: number;
};

const VIX_REF = 14;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function buildVolatilityContext(
  desk: SpxDeskPayload,
  technicals?: PlayTechnicals | null
): VolatilityContext {
  const vix = desk.vix ?? VIX_REF;
  const vixScale = clamp(vix / VIX_REF, 0.75, 1.6);

  let orWidth: number | null = null;
  let orScale = 1;
  if (technicals?.or_defined && technicals.or_high != null && technicals.or_low != null) {
    orWidth = Math.max(1, technicals.or_high - technicals.or_low);
    orScale = clamp(orWidth / 20, 0.85, 1.35);
  }

  const hod = desk.hod;
  const lod = desk.lod;
  const sessionRange =
    hod != null && lod != null && hod > lod ? hod - lod : orWidth;

  const atrProxy = sessionRange != null ? clamp(sessionRange * 0.35, 8, 45) : 15 * vixScale;

  return {
    vix,
    vix_scale: vixScale,
    or_width_pts: orWidth,
    or_scale: orScale,
    atr_proxy_pts: atrProxy,
    session_range_pts: sessionRange,
    distance_scale: clamp(vixScale * orScale, 0.7, 1.75),
  };
}

/** Scale a calm-RTH base point distance (e.g. 10) to today's session. */
export function scaledDistancePts(basePts: number, ctx: VolatilityContext): number {
  return clamp(basePts * ctx.distance_scale, basePts * 0.65, basePts * 2.5);
}

/** Scale a percent threshold (e.g. 0.3 gap %) by VIX regime. */
export function scaledPctThreshold(basePct: number, ctx: VolatilityContext): number {
  return basePct * clamp(ctx.vix_scale, 0.9, 1.45);
}
