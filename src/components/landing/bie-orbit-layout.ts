import type { OrbitTool } from "./BieOrbitTools";

export const TOOL_ORBIT_RINGS = [1, 2, 3, 4, 5, 6] as const;
export type ToolOrbitRing = (typeof TOOL_ORBIT_RINGS)[number];

/**
 * One instrument per ellipse — compass anchors from the product layout sketch.
 * angleDeg 0 = top of the field line; increases clockwise.
 */
export const TOOL_RING_ANCHOR_DEG: Record<ToolOrbitRing, number> = {
  1: 315, // inner top-left
  2: 138, // lower-right
  3: 268, // left
  4: 42, // top-right
  5: 328, // outer top-left
  6: 178, // bottom
};

export type PlacedOrbitTool = OrbitTool & {
  orbitRing: ToolOrbitRing;
  orbitScale: number;
  startAngleDeg: number;
  orbitPeriodSec: number;
  orbitDirection: 1 | -1;
};

const SESSION_KEY = "bie-orbit-seed";

/** Seeded PRNG — small speed jitter per session while anchors stay fixed. */
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

/** Base orbit period per ring — prime-ish steps so six solo bodies never sync up. */
const RING_ORBIT_PERIOD_SEC: Record<ToolOrbitRing, number> = {
  1: 92,
  2: 108,
  3: 124,
  4: 98,
  5: 116,
  6: 132,
};

const RING_ORBIT_DIRECTION: Record<ToolOrbitRing, 1 | -1> = {
  1: 1,
  2: -1,
  3: 1,
  4: -1,
  5: -1,
  6: 1,
};

/**
 * Place six tools on rings 1–6 (one each) at fixed compass anchors.
 * FIELD_TOOLS order maps to ring 1 → ring 6.
 */
export function buildOrbitLayout(
  tools: OrbitTool[],
  ringScales: Record<ToolOrbitRing, number>,
  seed: number
): PlacedOrbitTool[] {
  const rand = mulberry32(seed);

  return TOOL_ORBIT_RINGS.map((ring, i) => {
    const tool = tools[i] ?? tools[i % tools.length];
    const jitter = (rand() - 0.5) * 8;

    return {
      ...tool,
      orbitRing: ring,
      orbitScale: ringScales[ring],
      startAngleDeg: TOOL_RING_ANCHOR_DEG[ring],
      orbitPeriodSec: RING_ORBIT_PERIOD_SEC[ring] + jitter,
      orbitDirection: RING_ORBIT_DIRECTION[ring],
    };
  });
}

/** @deprecated Use buildOrbitLayout */
export const buildRandomOrbitLayout = buildOrbitLayout;

/** Angular distance between two orbit phases (0–180°). */
export function orbitAngularSeparationDeg(aDeg: number, bDeg: number): number {
  const diff = Math.abs(((aDeg % 360) + 360) % 360 - (((bDeg % 360) + 360) % 360));
  return diff > 180 ? 360 - diff : diff;
}
