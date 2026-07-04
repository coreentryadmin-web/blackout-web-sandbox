// Geometry for the BIE institutional reactor — center core, helix, concentric rings.

import { chordPath, goldenSpiralPoint, pointOnEllipse } from "./bie-brain-geometry";

export type Capability = {
  id: string;
  label: string;
  detail: string;
  angleDeg: number;
  /** 0 = innermost intelligence ring … 4 = outer */
  ring: 0 | 1 | 2 | 3 | 4;
  accent: string;
};

export type PlacedCapability = Capability & { x: number; y: number };

export type HelixStrand = { d: string; phase: number };

export type HelixRung = { x1: number; y1: number; x2: number; y2: number; depth: number };

export type IntelligenceRing = {
  ring: 0 | 1 | 2 | 3 | 4;
  rx: number;
  ry: number;
  d: string;
  /** CSS animation duration (seconds) — each ring independent */
  periodSec: number;
  reverse: boolean;
};

const RING_SCALE: Record<0 | 1 | 2 | 3 | 4, number> = {
  0: 0.42,
  1: 0.58,
  2: 0.72,
  3: 0.86,
  4: 0.98,
};

const RING_MOTION: Record<0 | 1 | 2 | 3 | 4, { periodSec: number; reverse: boolean }> = {
  0: { periodSec: 156, reverse: false },
  1: { periodSec: 124, reverse: true },
  2: { periodSec: 184, reverse: false },
  3: { periodSec: 208, reverse: true },
  4: { periodSec: 240, reverse: false },
};

export function ringRadii(ring: 0 | 1 | 2 | 3 | 4, maxRx: number, maxRy: number): { rx: number; ry: number } {
  const s = RING_SCALE[ring];
  return { rx: maxRx * s, ry: maxRy * s };
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
}

export function buildIntelligenceRings(cx: number, cy: number, maxRx: number, maxRy: number): IntelligenceRing[] {
  return ([0, 1, 2, 3, 4] as const).map((ring) => {
    const { rx, ry } = ringRadii(ring, maxRx, maxRy);
    const motion = RING_MOTION[ring];
    return { ring, rx, ry, d: ellipsePath(cx, cy, rx, ry), ...motion };
  });
}

/** Organic field-line distortion — planet/atom magnetosphere feel, not perfect ellipses. */
function fieldLineWarp(ringIndex: number, angleRad: number): number {
  const n1 = 3 + (ringIndex % 3);
  const n2 = 5 + ringIndex;
  const phase = ringIndex * 1.65;
  return (
    1 +
    0.058 * Math.sin(n1 * angleRad + phase) +
    0.038 * Math.sin(n2 * angleRad + phase * 0.55) +
    0.022 * Math.cos((n1 + n2) * 0.45 * angleRad + phase * 0.3)
  );
}

export type FieldLineRing = {
  ring: 1 | 2 | 3 | 4 | 5 | 6;
  layer: "inner" | "mid" | "outer";
  scale: number;
  d: string;
  periodSec: number;
  reverse: boolean;
};

const FIELD_LINE_CONFIG: Record<
  1 | 2 | 3 | 4 | 5 | 6,
  { scale: number; layer: "inner" | "mid" | "outer"; periodSec: number; reverse: boolean }
> = {
  1: { scale: 0.22, layer: "inner", periodSec: 148, reverse: true },
  2: { scale: 0.34, layer: "inner", periodSec: 172, reverse: false },
  3: { scale: 0.52, layer: "mid", periodSec: 196, reverse: true },
  4: { scale: 0.72, layer: "mid", periodSec: 220, reverse: false },
  5: { scale: 0.88, layer: "outer", periodSec: 248, reverse: true },
  6: { scale: 1, layer: "outer", periodSec: 272, reverse: false },
};

export function fieldLineScale(ring: 1 | 2 | 3 | 4 | 5 | 6): number {
  return FIELD_LINE_CONFIG[ring].scale;
}

export function buildFieldLinePath(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  scale: number,
  ringIndex: number,
  steps = 128
): string {
  const rx = maxRx * scale;
  const ry = maxRy * scale;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const rad = ((i / steps) * 360 - 90) * (Math.PI / 180);
    const w = fieldLineWarp(ringIndex, rad);
    pts.push({
      x: cx + rx * w * Math.cos(rad),
      y: cy + ry * w * Math.sin(rad),
    });
  }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  return `${d} Z`;
}

export function pointOnFieldLine(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  scale: number,
  ringIndex: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const w = fieldLineWarp(ringIndex, rad);
  return {
    x: cx + maxRx * scale * w * Math.cos(rad),
    y: cy + maxRy * scale * w * Math.sin(rad),
  };
}

export function buildFieldLineRings(cx: number, cy: number, maxRx: number, maxRy: number): FieldLineRing[] {
  return ([1, 2, 3, 4, 5, 6] as const).map((ring) => {
    const cfg = FIELD_LINE_CONFIG[ring];
    return {
      ring,
      layer: cfg.layer,
      scale: cfg.scale,
      d: buildFieldLinePath(cx, cy, maxRx, maxRy, cfg.scale, ring),
      periodSec: cfg.periodSec,
      reverse: cfg.reverse,
    };
  });
}

/** Layered volumetric glow — fills ~70–80% of viewport; core stays ~20–30%. */
export type AtmosphereGlow = {
  id: string;
  rx: number;
  ry: number;
  /** CSS class suffix */
  tier: "deep" | "mid" | "inner";
};

export function buildAtmosphereGlows(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number
): AtmosphereGlow[] {
  return [
    { id: "deep", tier: "deep", rx: maxRx * 1.06, ry: maxRy * 1.04 },
    { id: "mid", tier: "mid", rx: maxRx * 0.78, ry: maxRy * 0.78 },
    { id: "inner", tier: "inner", rx: maxRx * 0.48, ry: maxRy * 0.48 },
  ];
}

/** Sparse ambient mesh — faint depth lines across the field (composition only). */
export type AmbientFieldLine = { id: string; d: string };

export function buildAmbientFieldMesh(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  count = 14
): AmbientFieldLine[] {
  const lines: AmbientFieldLine[] = [];
  for (let i = 0; i < count; i++) {
    const a = goldenSpiralPoint(cx, cy, maxRx * 0.94, maxRy * 0.94, i, count);
    const b = goldenSpiralPoint(cx, cy, maxRx * 0.94, maxRy * 0.94, i + Math.floor(count / 2), count);
    lines.push({ id: `mesh-${i}`, d: chordPath(a.x, a.y, b.x, b.y, cx, cy, 4 + (i % 3) * 2) });
  }
  return lines;
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
  steps = 280,
  rungCount = 24
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
  const outer = pointOnFieldLine(cx, cy, maxRx, maxRy, FIELD_LINE_CONFIG[6].scale, 6, entryAngle);
  const mid = pointOnFieldLine(cx, cy, maxRx, maxRy, FIELD_LINE_CONFIG[3].scale, 3, entryAngle + 28);
  const exit = pointOnFieldLine(cx, cy, maxRx, maxRy, FIELD_LINE_CONFIG[5].scale, 5, entryAngle + 140);
  return `M ${outer.x.toFixed(1)} ${outer.y.toFixed(1)} Q ${mid.x.toFixed(1)} ${mid.y.toFixed(1)} ${cx} ${cy} Q ${(mid.x + cx) / 2} ${(mid.y + cy) / 2} ${exit.x.toFixed(1)} ${exit.y.toFixed(1)}`;
}

/** Slow intelligence pulse that sweeps across the full hero width through the core. */
export function buildHeroSweepPath(
  viewW: number,
  cy: number,
  cx: number,
  laneOffset: number
): string {
  const y0 = cy + laneOffset;
  const y1 = cy - laneOffset * 0.65;
  return `M 0 ${y0.toFixed(1)} Q ${(cx * 0.38).toFixed(1)} ${(cy - 52).toFixed(1)} ${cx} ${cy} Q ${(cx * 1.62).toFixed(1)} ${(cy + 48).toFixed(1)} ${viewW} ${y1.toFixed(1)}`;
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

/** Particles that continuously drift inward toward the core — OS "always working" feel. */
export type FlowParticle = {
  angle: number;
  dist: number;
  speed: number;
  size: number;
  opacity: number;
};

export function buildFlowParticles(count: number): FlowParticle[] {
  return Array.from({ length: count }, (_, i) => ({
    angle: (i * 137.50776) % 360,
    dist: 0.52 + (i % 19) / 28,
    speed: 0.00038 + (i % 6) * 0.00011,
    size: i % 5 === 0 ? 1.15 : 0.7,
    opacity: 0.14 + (i % 5) * 0.045,
  }));
}

export function flowParticlePosition(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  p: FlowParticle
): { x: number; y: number } {
  const rad = ((p.angle - 90) * Math.PI) / 180;
  const rx = maxRx * 1.06 * p.dist;
  const ry = maxRy * 1.06 * p.dist;
  return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
}

/** Tiny ambient particles spread across ~78% of the viewport — the intelligence field. */
export type FieldParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  opacity: number;
  size: number;
  /** Radians — desynchronizes star twinkle. */
  twinklePhase: number;
  /** Multiplier for twinkle speed. */
  twinkleSpeed: number;
};

function fieldSeed(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function buildFieldParticles(
  count: number,
  viewW: number,
  viewH: number,
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number
): FieldParticle[] {
  const padX = viewW * 0.02;
  const padY = viewH * 0.02;
  return Array.from({ length: count }, (_, i) => {
    const t = fieldSeed(i, 1);
    const u = fieldSeed(i, 2);
    const v = fieldSeed(i, 3);
    const w = fieldSeed(i, 4);
    const x = padX + t * (viewW - padX * 2);
    const y = padY + u * (viewH - padY * 2);
    const dx = x - cx;
    const dy = y - cy;
    const distNorm = Math.hypot(dx / maxRx, dy / maxRy);
    const bias = 0.65 + fieldSeed(i, 9) * 0.35;
    const maxLife = 180 + Math.floor(v * 420);
    return {
      x,
      y,
      vx: (w - 0.5) * 0.06 * bias,
      vy: (fieldSeed(i, 5) - 0.5) * 0.06 * bias,
      life: Math.floor(fieldSeed(i, 6) * maxLife),
      maxLife,
      opacity: (0.028 + fieldSeed(i, 7) * 0.062) * (0.85 + distNorm * 0.15),
      size: fieldSeed(i, 8) < 0.14 ? 2.1 : 1.35,
      twinklePhase: fieldSeed(i, 10) * Math.PI * 2,
      twinkleSpeed: 0.55 + fieldSeed(i, 11) * 1.45,
    };
  });
}

/** Nodes placed on intelligence rings — occasional neural connections between them. */
export type NeuralNode = {
  id: number;
  x: number;
  y: number;
  ring: 0 | 1 | 2 | 3 | 4;
};

export function buildNeuralNodes(
  count: number,
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number
): NeuralNode[] {
  return Array.from({ length: count }, (_, i) => {
    const ring = (i % 5) as 0 | 1 | 2 | 3 | 4;
    const angle = (i * 360) / count + ring * 14;
    const { rx, ry } = ringRadii(ring, maxRx, maxRy);
    const p = pointOnEllipse(cx, cy, rx, ry, angle);
    return { id: i, x: p.x, y: p.y, ring };
  });
}

/** Inbound signal: outer field particle arcs toward the BIE core. */
export function buildInboundPulsePath(
  fromX: number,
  fromY: number,
  cx: number,
  cy: number
): string {
  const mx = (fromX + cx) / 2;
  const my = (fromY + cy) / 2;
  const dx = cx - fromX;
  const dy = cy - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const bow = len * 0.18;
  const qx = mx - (dy / len) * bow;
  const qy = my + (dx / len) * bow;
  return `M ${fromX.toFixed(1)} ${fromY.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${cx} ${cy}`;
}

/** Field glow radii — primary volumetric read at viewport scale. */
export function fieldGlowRadii(viewW: number, viewH: number): { rx: number; ry: number } {
  return { rx: viewW * 0.52, ry: viewH * 0.48 };
}

/** Glowing nodes on field-line ellipses. */
export type RingFieldNode = {
  id: string;
  ring: 1 | 2 | 4 | 5 | 6;
  x: number;
  y: number;
  index: number;
};

export function buildInnerFieldNodes(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  rings: readonly (1 | 2)[],
  nodesPerRing: number
): RingFieldNode[] {
  const nodes: RingFieldNode[] = [];
  for (const ring of rings) {
    const scale = FIELD_LINE_CONFIG[ring].scale;
    for (let i = 0; i < nodesPerRing; i++) {
      const angleDeg = (360 / nodesPerRing) * i + ring * 17;
      const p = pointOnFieldLine(cx, cy, maxRx, maxRy, scale, ring, angleDeg);
      nodes.push({ id: `r${ring}-n${i}`, ring, x: p.x, y: p.y, index: i });
    }
  }
  return nodes;
}

/** @deprecated Use buildInnerFieldNodes — kept for tests. */
export function buildRingFieldNodes(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  rings: readonly (1 | 2 | 3 | 4)[],
  nodesPerRing: number
): RingFieldNode[] {
  const inner = rings.filter((r): r is 1 | 2 => r === 1 || r === 2);
  return buildInnerFieldNodes(cx, cy, maxRx, maxRy, inner.length ? inner : [1, 2], nodesPerRing);
}

/** Bowed segment between adjacent ring nodes — slow pulse travels along this path. */
export function buildRingSegmentPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  bow: number
): string {
  return chordPath(x0, y0, x1, y1, cx, cy, bow);
}
