import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { playMtfBufferPts, playStructureProximityPts } from "@/features/spx/lib/spx-play-config";

/** VIX reference for scaling (typical calm RTH). */
const VIX_REF = 14;

/** Clamp scaled distance to sane 0DTE SPX range. */
function clampPts(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * MTF / OR break buffer scaled by VIX and opening-range width.
 * Replaces static `playMtfBufferPts()` for playbook matchers.
 */
export function scaledPlaybookMtfBufferPts(
  desk: SpxDeskPayload,
  technicals?: PlayTechnicals | null
): number {
  const base = playMtfBufferPts();
  const vix = desk.vix ?? VIX_REF;
  const vixScale = clampPts(vix / VIX_REF, 0.75, 1.5);

  let orScale = 1;
  if (technicals?.or_defined && technicals.or_high != null && technicals.or_low != null) {
    const orWidth = Math.max(1, technicals.or_high - technicals.or_low);
    // Wider OR → slightly larger buffer (max ~1.25× at 40pt range)
    orScale = clampPts(orWidth / 20, 0.85, 1.25);
  }

  return clampPts(base * vixScale * orScale, 0.5, 4);
}

/** Wall proximity scaled by VIX — high vol = slightly wider touch zone. */
export function scaledPlaybookStructureProximityPts(desk: SpxDeskPayload): number {
  const base = playStructureProximityPts();
  const vix = desk.vix ?? VIX_REF;
  const vixScale = clampPts(vix / VIX_REF, 0.8, 1.35);
  return clampPts(base * vixScale, 6, 18);
}

/** Gap / range percent thresholds scaled by VIX (inverse — high VIX = larger moves normal). */
export function scaledPlaybookGapPct(desk: SpxDeskPayload, basePct: number): number {
  const vix = desk.vix ?? VIX_REF;
  const scale = clampPts(vix / VIX_REF, 0.9, 1.4);
  return basePct * scale;
}
