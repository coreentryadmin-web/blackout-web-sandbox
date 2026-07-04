// Geometry for the BIE institutional reactor — helix hero + concentric rings.

import { goldenSpiralPoint, pointOnEllipse } from "./bie-brain-geometry";

export type Capability = {
  id: string;
  label: string;
  detail: string;
  angleDeg: number;
  /** 0 = innermost intelligence ring … 3 = outer */
  ring: 0 | 1 | 2 | 3;
  accent: string;
};

export type PlacedCapability = Capability & { x: number; y: number };

export type HelixStrand = { d: string; phase: number };

export type HelixRung = { x1: number; y1: number; x2: number; y2: number; depth: number };

export type IntelligenceRing = {
  ring: 0 | 1 | 2 | 3;
  rx: number;
  ry: number;
  d: string;
  /** CSS animation duration (seconds) — each ring independent */
  periodSec: number;
  reverse: boolean;
};

const RING_SCALE: Record<0 | 1 | 2 | 3, number> = {
  0: 0.42,
  1: 0.58,
  2: 0.74,
  3: 0.9,
};

const RING_MOTION: Record<0 | 1 | 2 | 3, { periodSec: number; reverse: boolean }> = {
  0: { periodSec: 140, reverse: false },
  1: { periodSec: 108, reverse: true },
  2: { periodSec: 168, reverse: false },
  3: { periodSec: 192, reverse: true },
};

export function ringRadii(ring: 0 | 1 | 2 | 3, maxRx: number, maxRy: number): { rx: number; ry: number } {
  const s = RING_SCALE[ring];
  return { rx: maxRx * s, ry: maxRy * s };
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
}

export function buildIntelligenceRings(cx: number, cy: number, maxRx: number, maxRy: number): IntelligenceRing[] {
  return ([0, 1, 2, 3] as const).map((ring) => {
    const { rx, ry } = ringRadii(ring, maxRx, maxRy);
    const motion = RING_MOTION[ring];
    return { ring, rx, ry, d: ellipsePath(cx, cy, rx, ry), ...motion };
  });
}

export function placeCapability(
  cx: number,
  cy: number,
  cap: Capability,
  maxRx: number,
  maxRy: number
): PlacedCapability {
  const { rx, ry } = ringRadii(cap.ring, maxRx, maxRy);
  const p = pointOnEllipse(cx, cy, rx, ry, cap.angleDeg);
  return { ...cap, x: p.x, y: p.y };
}

export function placeCapabilities(
  cx: number,
  cy: number,
  caps: Capability[],
  maxRx: number,
  maxRy: number
): PlacedCapability[] {
  return caps.map((c) => placeCapability(cx, cy, c, maxRx, maxRy));
}

/** Vertical double-helix centered in the reactor — the visual hero. */
export function buildCenterHelix(
  cx: number,
  cy: number,
  height: number,
  width: number,
  steps = 240
): { strandA: string; strandB: string; rungs: HelixRung[] } {
  const halfH = height / 2;
  const top = cy - halfH;
  const amp = width / 2;
  const period = height / 3.2;

  const strand = (phase: number) => {
    const parts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const y = top + (i / steps) * height;
      const x = cx + amp * Math.sin(((y - top) / period) * 2 * Math.PI + phase);
      parts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return parts.join(" ");
  };

  const rungCount = 18;
  const rungs: HelixRung[] = [];
  for (let i = 0; i < rungCount; i++) {
    const y = top + ((i + 0.5) / rungCount) * height;
    const t = ((y - top) / period) * 2 * Math.PI;
    const x1 = cx + amp * Math.sin(t);
    const x2 = cx + amp * Math.sin(t + Math.PI);
    const depth = Math.abs(Math.cos(t));
    rungs.push({ x1, y1: y, x2, y2: y, depth });
  }

  return { strandA: strand(0), strandB: strand(Math.PI), rungs };
}

/** Single neural impulse: outer ring → core → radiate outward on mid ring. */
export function buildImpulsePath(
  cx: number,
  cy: number,
  entryAngle: number,
  maxRx: number,
  maxRy: number
): string {
  const outer = pointOnEllipse(cx, cy, maxRx * RING_SCALE[3], maxRy * RING_SCALE[3], entryAngle);
  const mid = pointOnEllipse(cx, cy, maxRx * RING_SCALE[1], maxRy * RING_SCALE[1], entryAngle + 28);
  const exit = pointOnEllipse(cx, cy, maxRx * RING_SCALE[2], maxRy * RING_SCALE[2], entryAngle + 140);
  return `M ${outer.x.toFixed(1)} ${outer.y.toFixed(1)} Q ${mid.x.toFixed(1)} ${mid.y.toFixed(1)} ${cx} ${cy} Q ${(mid.x + cx) / 2} ${(mid.y + cy) / 2} ${exit.x.toFixed(1)} ${exit.y.toFixed(1)}`;
}

export function buildStarField(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  count: number
): { x: number; y: number; r: number; opacity: number; phase: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const p = goldenSpiralPoint(cx, cy, maxRx * 1.02, maxRy * 1.02, i, count);
    return {
      x: p.x,
      y: p.y,
      r: i % 11 === 0 ? 0.75 : 0.45,
      opacity: 0.035 + (i % 7) * 0.008,
      phase: (i * 0.71) % (Math.PI * 2),
    };
  });
}
