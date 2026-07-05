// A fixed, perfectly regular polar grid rendered behind the organic field lines —
// the contrast between "rigid instrument grid" (this) and "organic living field"
// (bie-helix-engine's rings) sells the idea that BIE is a real instrument reading
// a live system, not decoration floating in empty space. Deliberately static (no
// rotation/animation) so it reads as fixed infrastructure the living field moves
// within, rather than one more animated layer competing for attention. Pure
// geometry, split out so it's unit-testable without a browser/DOM.

import { pointOnEllipse } from "./bie-brain-geometry";

export type InstrumentGridRing = { rx: number; ry: number };
export type InstrumentGridSpoke = { x1: number; y1: number; x2: number; y2: number; angleDeg: number };

/** `count` concentric, evenly-spaced ellipses at the same aspect ratio as the field's outermost extent. */
export function buildInstrumentGridRings(count: number, maxRx: number, maxRy: number): InstrumentGridRing[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 1) / count;
    return { rx: maxRx * t, ry: maxRy * t };
  });
}

/**
 * `count` evenly-spaced radial spokes, each a straight line from a point near
 * the core out to the outermost ring. The inner endpoint is `innerFraction` of
 * the way along the same vector as the outer endpoint (not a separately-angled
 * point), so inner/outer/origin are exactly colinear regardless of maxRx/maxRy's
 * aspect ratio — no separate "radial" math needed, just a scalar shrink.
 */
export function buildInstrumentGridSpokes(
  count: number,
  maxRx: number,
  maxRy: number,
  innerFraction: number
): InstrumentGridSpoke[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angleDeg = (360 / count) * i;
    const outer = pointOnEllipse(0, 0, maxRx, maxRy, angleDeg);
    return {
      x1: outer.x * innerFraction,
      y1: outer.y * innerFraction,
      x2: outer.x,
      y2: outer.y,
      angleDeg,
    };
  });
}
