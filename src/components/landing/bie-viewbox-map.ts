import { pointOnFieldLine } from "./bie-helix-engine";

/** Advance orbital phase (degrees) for one animation tick. */
export function advanceOrbitDeg(
  current: number,
  dtSec: number,
  periodSec: number,
  direction: 1 | -1 = 1
): number {
  if (periodSec <= 0 || dtSec <= 0) return current;
  const next = current + direction * (360 / periodSec) * dtSec;
  return ((next % 360) + 360) % 360;
}

/** Map SVG viewBox coordinates to pixel positions inside a container (matches preserveAspectRatio meet/slice). */
export function viewBoxPointToContainer(
  vx: number,
  vy: number,
  containerW: number,
  containerH: number,
  viewW: number,
  viewH: number,
  mode: "slice" | "meet" = "meet"
): { x: number; y: number; scale: number } {
  const scale =
    mode === "slice"
      ? Math.max(containerW / viewW, containerH / viewH)
      : Math.min(containerW / viewW, containerH / viewH);
  const offsetX = (containerW - viewW * scale) / 2;
  const offsetY = (containerH - viewH * scale) / 2;
  return {
    x: offsetX + vx * scale,
    y: offsetY + vy * scale,
    scale,
  };
}

/** Position one tool on a field ring. */
export function orbitToolPixelPosition(args: {
  startAngleDeg: number;
  orbitDeg: number;
  coreX: number;
  coreY: number;
  maxRx: number;
  maxRy: number;
  orbitRing: number;
  orbitScale: number;
  viewW: number;
  viewH: number;
  containerW: number;
  containerH: number;
}): { x: number; y: number } {
  const angle = args.startAngleDeg + args.orbitDeg;
  const vb = pointOnFieldLine(
    args.coreX,
    args.coreY,
    args.maxRx,
    args.maxRy,
    args.orbitScale,
    args.orbitRing,
    angle
  );
  return viewBoxPointToContainer(
    vb.x,
    vb.y,
    args.containerW,
    args.containerH,
    args.viewW,
    args.viewH,
    "meet"
  );
}
