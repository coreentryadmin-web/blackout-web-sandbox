import { fieldLineScale, pointOnFieldLine, type RingFieldNode } from "./bie-helix-engine";
import type { OrbitTool } from "./BieOrbitTools";

export const TOOL_ORBIT_RINGS = [4, 5, 6] as const;
export type ToolOrbitRing = (typeof TOOL_ORBIT_RINGS)[number];

export const FIELD_NODE_RINGS = TOOL_ORBIT_RINGS;
export type FieldNodeRing = ToolOrbitRing;

/** Opposite-side spacing (degrees) for the two tools sharing one ring. */
export const ORBIT_PAIR_SEPARATION_DEG = 180;

/** Stagger each ring's base angle so cross-ring tools don't stack on one radial. */
export const ORBIT_RING_STAGGER_DEG = 120;

export type PlacedOrbitTool = OrbitTool & {
  orbitRing: ToolOrbitRing;
  orbitScale: number;
  startAngleDeg: number;
  orbitPeriodSec: number;
  orbitDirection: 1 | -1;
};

const SESSION_KEY = "bie-orbit-seed";

/** Seeded PRNG — deterministic layout per session seed. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isToolOrbitRing(ring: number): ring is ToolOrbitRing {
  return (TOOL_ORBIT_RINGS as readonly number[]).includes(ring);
}

/** Stable per-tab seed so each visitor gets a unique but consistent layout. */
export function readSessionOrbitSeed(): number {
  if (typeof window === "undefined") return Date.now() >>> 0;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      const n = Number.parseInt(existing, 10);
      if (Number.isFinite(n)) return n >>> 0;
    }
    const seed = (Math.random() * 0xffffffff) >>> 0;
    sessionStorage.setItem(SESSION_KEY, String(seed));
    return seed;
  } catch {
    return (Math.random() * 0xffffffff) >>> 0;
  }
}

function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Shuffle six tools onto rings 4/5/6 (two per ring). Each pair stays 180° apart
 * on the same period/direction so they never lap or collide; rings are staggered.
 */
export function buildRandomOrbitLayout(
  tools: OrbitTool[],
  ringScales: Record<ToolOrbitRing, number>,
  seed: number
): PlacedOrbitTool[] {
  const rand = mulberry32(seed);
  const shuffled = [...tools];
  shuffleInPlace(shuffled, rand);

  return TOOL_ORBIT_RINGS.flatMap((ring, ringIdx) => {
    const pair = shuffled.slice(ringIdx * 2, ringIdx * 2 + 2);
    const ringBaseDeg = (rand() * 360 + ringIdx * ORBIT_RING_STAGGER_DEG) % 360;
    const orbitPeriodSec = 84 + rand() * 48;
    const orbitDirection = rand() < 0.5 ? (-1 as const) : (1 as const);

    return pair.map((tool, pairIdx) => ({
      ...tool,
      orbitRing: ring,
      orbitScale: ringScales[ring],
      startAngleDeg: (ringBaseDeg + pairIdx * ORBIT_PAIR_SEPARATION_DEG) % 360,
      orbitPeriodSec,
      orbitDirection,
    }));
  });
}

/** Twinkling star nodes on the three outer tool ellipses — random angle per session. */
export function buildRandomFieldNodes(
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  nodesPerRing: number,
  seed: number
): RingFieldNode[] {
  const rand = mulberry32(seed ^ 0xcafebabe);
  const nodes: RingFieldNode[] = [];

  for (const ring of FIELD_NODE_RINGS) {
    const scale = fieldLineScale(ring);
    for (let i = 0; i < nodesPerRing; i++) {
      const angleDeg = rand() * 360;
      const p = pointOnFieldLine(cx, cy, maxRx, maxRy, scale, ring, angleDeg);
      nodes.push({ id: `r${ring}-n${i}`, ring, x: p.x, y: p.y, index: i });
    }
  }

  return nodes;
}

/** Angular distance between two orbit phases (0–180°). */
export function orbitAngularSeparationDeg(aDeg: number, bDeg: number): number {
  const diff = Math.abs(((aDeg % 360) + 360) % 360 - (((bDeg % 360) + 360) % 360));
  return diff > 180 ? 360 - diff : diff;
}
