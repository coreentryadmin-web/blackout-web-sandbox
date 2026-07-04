// Pure geometry builders for BieBrainBanner — split out from the component so the
// generated coordinates/paths are unit-testable without a browser/DOM.

/**
 * Point at `angleDeg` (0 = straight up, clockwise) on an ellipse centered at
 * (cx, cy) with radii (rx, ry) — used for BOTH the instrument-node ring and the
 * ambient dust field. `rx > ry` fakes a disc viewed at an angle (a tilted
 * "sphere/globe" look) using plain 2D math, with none of the layout-box-vs-
 * paint-size mismatch that a CSS `rotateX` 3D tilt would introduce on a square
 * SVG viewBox. Pass `rx === ry` for a true circle.
 */
export function pointOnEllipse(cx: number, cy: number, rx: number, ry: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
}

/**
 * Quadratic-curve path between two arbitrary points, bowed away from a center
 * (cx, cy) by `bow` pixels along the center→midpoint direction. `bow = 0`
 * degenerates to a straight line — this one function covers both the straight
 * core→node spokes and the outward-curved ring/cross connections between
 * instrument nodes, instead of needing a separate helper for each.
 */
export function chordPath(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, bow: number): string {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = mx - cx;
  const dy = my - cy;
  const len = Math.hypot(dx, dy) || 1;
  const qx = mx + (dx / len) * bow;
  const qy = my + (dy / len) * bow;
  return `M${x0},${y0} Q${qx},${qy} ${x1},${y1}`;
}

/**
 * Index `i` of `count` points spread evenly across an elliptical disc (radii
 * maxRx/maxRy) around (cx, cy) via the golden-angle spiral (the standard "fill
 * a disc with N evenly-distributed points" construction) — the ambient
 * background dots that make the diagram read as a dense sphere rather than 6
 * isolated nodes on empty space. Deterministic (no RNG), so it's stable across
 * renders and unit-testable.
 */
const GOLDEN_ANGLE_DEG = 137.50776;

export function goldenSpiralPoint(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  i: number,
  count: number
): { x: number; y: number } {
  const t = Math.sqrt((i + 0.5) / count);
  return pointOnEllipse(cx, cy, maxRx * t, maxRy * t, i * GOLDEN_ANGLE_DEG);
}
