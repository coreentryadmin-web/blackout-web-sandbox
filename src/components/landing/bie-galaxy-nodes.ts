import { fieldLineScale, pointOnFieldLine } from "./bie-helix-engine";
import { mulberry32 } from "./bie-orbit-layout";

export const GALAXY_NODE_RINGS = [1, 2, 3, 4, 5, 6] as const;
export type GalaxyNodeRing = (typeof GALAXY_NODE_RINGS)[number];

export type GalaxyNodeShape = "orb" | "diamond" | "cross" | "spark" | "ring" | "shard";
export type GalaxyNodeBehavior = "steady" | "breathe" | "flicker" | "teleport" | "drift" | "flare";
export type GalaxyNodeTint = "gold" | "cyan" | "violet" | "pearl";

/** Per-session blueprint — each body gets its own temperament. */
export type GalaxyNodeSpec = {
  id: string;
  ring: GalaxyNodeRing;
  angleDeg: number;
  shape: GalaxyNodeShape;
  size: number;
  brightness: number;
  behavior: GalaxyNodeBehavior;
  phase: number;
  pulseHz: number;
  flickerSkew: number;
  teleportEverySec: number;
  driftDegPerSec: number;
  tint: GalaxyNodeTint;
  rotationDeg: number;
  spinDegPerSec: number;
};

export type GalaxyNodeRuntime = GalaxyNodeSpec & {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  teleportPhase: "visible" | "out" | "in";
  fadeT: number;
  nextTeleportAt: number;
  teleportSeq: number;
};

/** Inner ellipses carry more bodies — galaxy density falls off with radius. */
export const GALAXY_NODES_BY_RING: Record<GalaxyNodeRing, number> = {
  1: 24,
  2: 22,
  3: 18,
  4: 14,
  5: 10,
  6: 8,
};

const SHAPES: GalaxyNodeShape[] = ["orb", "diamond", "cross", "spark", "ring", "shard"];
const BEHAVIORS: GalaxyNodeBehavior[] = ["steady", "breathe", "flicker", "teleport", "drift", "flare"];
const TINTS: GalaxyNodeTint[] = ["gold", "cyan", "violet", "pearl"];

function pickWeighted<T>(items: T[], weights: number[], rand: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rand() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function buildGalaxyFieldNodes(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  seed: number
): GalaxyNodeRuntime[] {
  const rand = mulberry32(seed ^ 0x6a1a7a01);
  const nodes: GalaxyNodeRuntime[] = [];
  let idx = 0;

  for (const ring of GALAXY_NODE_RINGS) {
    const count = GALAXY_NODES_BY_RING[ring];
    const scale = fieldLineScale(ring);
    const innerBias = ring <= 3;

    for (let i = 0; i < count; i++) {
      const angleDeg = rand() * 360;
      const shape = pickWeighted(SHAPES, innerBias ? [2, 3, 2, 4, 2, 3] : [3, 2, 2, 3, 3, 2], rand);
      const behavior = pickWeighted(
        BEHAVIORS,
        innerBias ? [2, 3, 4, 3, 3, 2] : [3, 2, 2, 2, 2, 1],
        rand
      );
      const size = (innerBias ? 2.2 : 1.6) + rand() * (innerBias ? 4.8 : 3.6);
      const brightness = 0.28 + rand() * 0.72;
      const tint = pickWeighted(TINTS, innerBias ? [4, 3, 2, 2] : [3, 3, 2, 2], rand);

      const spec: GalaxyNodeSpec = {
        id: `gx-${ring}-${idx}`,
        ring,
        angleDeg,
        shape,
        size,
        brightness,
        behavior,
        phase: rand() * Math.PI * 2,
        pulseHz: 0.35 + rand() * 1.4,
        flickerSkew: 0.4 + rand() * 2.2,
        teleportEverySec: 6 + rand() * 14,
        driftDegPerSec: (rand() < 0.5 ? -1 : 1) * (2 + rand() * 9),
        tint,
        rotationDeg: rand() * 360,
        spinDegPerSec: (rand() - 0.5) * 28,
      };

      const p = pointOnFieldLine(cx, cy, maxRx, maxRy, scale, ring, angleDeg);
      nodes.push({
        ...spec,
        x: p.x,
        y: p.y,
        opacity: brightness * (0.65 + rand() * 0.35),
        scale: 1,
        teleportPhase: "visible",
        fadeT: 0,
        nextTeleportAt: spec.phase + rand() * spec.teleportEverySec,
        teleportSeq: 0,
      });
      idx++;
    }
  }

  return nodes;
}

export function galaxyTintRgb(tint: GalaxyNodeTint, alpha: number): string {
  switch (tint) {
    case "cyan":
      return `rgba(93, 247, 255, ${alpha})`;
    case "violet":
      return `rgba(191, 140, 255, ${alpha})`;
    case "pearl":
      return `rgba(255, 248, 230, ${alpha})`;
    default:
      return `rgba(255, 220, 120, ${alpha})`;
  }
}

/** Closed path for filled galaxy bodies (ring uses stroke in the renderer). */
export function galaxyShapePath(shape: GalaxyNodeShape, size: number): string | null {
  const s = size;
  switch (shape) {
    case "orb":
      return `M 0 ${-s} A ${s} ${s} 0 1 1 0 ${s} A ${s} ${s} 0 1 1 0 ${-s} Z`;
    case "diamond":
      return `M 0 ${-s} L ${s * 0.62} 0 L 0 ${s} L ${-s * 0.62} 0 Z`;
    case "cross": {
      const w = s * 0.2;
      return [
        `M ${-w} ${-s} L ${w} ${-s} L ${w} ${-w} L ${s} ${-w}`,
        `L ${s} ${w} L ${w} ${w} L ${w} ${s} L ${-w} ${s}`,
        `L ${-w} ${w} L ${-s} ${w} L ${-s} ${-w} L ${-w} ${-w} Z`,
      ].join(" ");
    }
    case "spark":
      return `M 0 ${-s} L ${s * 0.28} ${-s * 0.28} L ${s} 0 L ${s * 0.28} ${s * 0.28} L 0 ${s} L ${-s * 0.28} ${s * 0.28} L ${-s} 0 L ${-s * 0.28} ${-s * 0.28} Z`;
    case "shard":
      return `M 0 ${-s} L ${s * 0.55} ${s * 0.55} L ${-s * 0.4} ${s * 0.15} Z`;
    case "ring":
      return null;
    default:
      return null;
  }
}

function teleportAngle(spec: GalaxyNodeSpec, seq: number): number {
  const rand = mulberry32((seq + 1) * 0x9e3779b9 ^ spec.phase * 1000);
  return rand() * 360;
}

/** Advance one simulation step — positions, opacity, scale, teleports. */
export function tickGalaxyFieldNodes(
  nodes: GalaxyNodeRuntime[],
  tSec: number,
  dt: number,
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number
): void {
  for (const n of nodes) {
    const scale = fieldLineScale(n.ring);

    if (n.behavior === "drift") {
      n.angleDeg = (n.angleDeg + n.driftDegPerSec * dt + 360) % 360;
    }

    n.rotationDeg = (n.rotationDeg + n.spinDegPerSec * dt + 360) % 360;

    let opacity = n.brightness;
    let nodeScale = 1;

    switch (n.behavior) {
      case "steady":
        opacity *= 0.82 + 0.18 * Math.sin(tSec * n.pulseHz * Math.PI * 2 + n.phase);
        break;
      case "breathe":
        nodeScale = 0.78 + 0.38 * (0.5 + 0.5 * Math.sin(tSec * n.pulseHz * Math.PI * 2 + n.phase));
        opacity *= 0.7 + 0.3 * Math.sin(tSec * n.pulseHz * 0.85 * Math.PI * 2 + n.phase);
        break;
      case "flicker": {
        const spike = Math.sin(tSec * n.pulseHz * 6.2 * Math.PI * 2 + n.phase);
        const crack = Math.sin(tSec * n.flickerSkew * 19 * Math.PI * 2 + n.phase * 1.7);
        opacity *= 0.15 + 0.85 * Math.max(0, spike * 0.55 + crack * 0.45);
        break;
      }
      case "flare": {
        const base = 0.45 + 0.35 * Math.sin(tSec * n.pulseHz * Math.PI * 2 + n.phase);
        const burst = Math.pow(Math.max(0, Math.sin(tSec * 0.45 + n.phase)), 12);
        opacity *= base + burst * 0.85;
        nodeScale = 1 + burst * 0.55;
        break;
      }
      case "teleport":
        if (n.teleportPhase === "visible" && tSec >= n.nextTeleportAt) {
          n.teleportPhase = "out";
          n.fadeT = 0;
        }
        if (n.teleportPhase === "out") {
          n.fadeT += dt;
          if (n.fadeT >= 0.42) {
            n.teleportSeq++;
            n.angleDeg = teleportAngle(n, n.teleportSeq);
            n.teleportPhase = "in";
            n.fadeT = 0;
            opacity = 0;
          } else {
            opacity *= 1 - n.fadeT / 0.42;
          }
        } else if (n.teleportPhase === "in") {
          n.fadeT += dt;
          opacity *= Math.min(1, n.fadeT / 0.75);
          if (n.fadeT >= 0.75) {
            n.teleportPhase = "visible";
            n.nextTeleportAt = tSec + n.teleportEverySec * (0.65 + 0.7 * Math.abs(Math.sin(n.phase + tSec * 0.07)));
          }
        }
        break;
      default:
        break;
    }

    const p = pointOnFieldLine(cx, cy, maxRx, maxRy, scale, n.ring, n.angleDeg);
    n.x = p.x;
    n.y = p.y;
    n.opacity = Math.max(0, Math.min(1, opacity));
    n.scale = nodeScale;
  }
}

export function countGalaxyFieldNodes(): number {
  return GALAXY_NODE_RINGS.reduce((sum, ring) => sum + GALAXY_NODES_BY_RING[ring], 0);
}
