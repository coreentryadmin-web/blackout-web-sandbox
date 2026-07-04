import type { OrbitTool } from "./BieOrbitTools";

export const TOOL_ORBIT_RINGS = [4, 5, 6] as const;
export type ToolOrbitRing = (typeof TOOL_ORBIT_RINGS)[number];

export type PlacedOrbitTool = OrbitTool & {
  orbitRing: ToolOrbitRing;
  orbitScale: number;
  startAngleDeg: number;
  orbitPeriodSec: number;
  orbitDirection: 1 | -1;
  /** Seconds between subtle random reposition nudges along the ring. */
  wanderIntervalSec: number;
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
 * Shuffle six tools onto rings 4/5/6 (two per ring) with random phases,
 * speeds, and directions — unique per session seed.
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
    return pair.map((tool) => ({
      ...tool,
      orbitRing: ring,
      orbitScale: ringScales[ring],
      startAngleDeg: rand() * 360,
      orbitPeriodSec: 78 + rand() * 54,
      orbitDirection: rand() < 0.5 ? (-1 as const) : (1 as const),
      wanderIntervalSec: 22 + rand() * 28,
    }));
  });
}

/** Small random nudge along the ring — keeps positions evolving over time. */
export function wanderOrbitDeg(current: number, rand: () => number): number {
  const delta = (rand() - 0.5) * 72;
  return (current + delta + 360) % 360;
}
