import { getCurrentSpxCandle } from "@/lib/ws/spx-candle-store";
import { getGexStrikeExpiryLadder } from "@/lib/ws/uw-socket";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import {
  darkPoolLevelsFromSnapshot,
  type VectorDarkPoolLevel,
} from "@/lib/providers/vector-dark-pool-levels";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
  nextWallScope,
  type GexWalls,
  type WallScopeState,
} from "@/lib/providers/gex-wall-levels";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { persistWallSampleDebounced } from "@/lib/providers/vector-wall-persist";
import { bucketWallSampleTime } from "@/lib/providers/vector-wall-sample";
import { recordWallSample, type WallHistorySample } from "@/lib/providers/vector-wall-history";
import { fetchUwDarkPool } from "@/lib/providers/unusual-whales";

const WALL_SCOPE_REFRESH_MS = 15_000;
const DARK_POOL_REFRESH_MS = 60_000;
/** SPX heatmap cache cadence — honest VEX wall refresh (no UW vanna WS). */
const VEX_WALLS_CACHE_MS = 8_000;
let wallScope: WallScopeState = { expiries: undefined, fetchedAt: 0 };
let wallScopeInFlight: Promise<void> | null = null;
let fallbackStrikeTotals: Record<string, number> | null = null;
let fallbackVexStrikeTotals: Record<string, number> | null = null;
let cachedVexFlip: number | null = null;

const WALLS_CACHE_MS = 900;
let cachedWalls: GexWalls | null = null;
let cachedWallsAt = 0;

let cachedVexWalls: GexWalls | null = null;
let cachedVexWallsAt = 0;

let cachedFlip: number | null = null;
let cachedFlipAt = 0;
const FLIP_CACHE_MS = 5_000;

let cachedDarkPool: VectorDarkPoolLevel[] = [];
let cachedDarkPoolAt = 0;
let darkPoolInFlight: Promise<void> | null = null;

function refreshWallScope(): void {
  const now = Date.now();
  if (now - wallScope.fetchedAt < WALL_SCOPE_REFRESH_MS || wallScopeInFlight) return;
  wallScopeInFlight = runWallScopeFetch();
}

function runWallScopeFetch(): Promise<void> {
  return fetchGexHeatmap("SPX")
    .then((hm) => {
      wallScope = nextWallScope(wallScope, Date.now(), hm);
      if (hm?.gex?.strike_totals && Object.keys(hm.gex.strike_totals).length > 0) {
        fallbackStrikeTotals = hm.gex.strike_totals;
      }
      if (hm?.vex?.strike_totals && Object.keys(hm.vex.strike_totals).length > 0) {
        fallbackVexStrikeTotals = hm.vex.strike_totals;
        cachedVexFlip = hm.vex.flip ?? null;
        cachedVexWalls = computeGexWalls(mapFromStrikeTotalsRecord(hm.vex.strike_totals));
        cachedVexWallsAt = Date.now();
      }
    })
    .catch(() => {
      wallScope = nextWallScope(wallScope, Date.now(), null);
    })
    .finally(() => {
      wallScopeInFlight = null;
    });
}

/** SSR / first paint — await heatmap scope so VEX walls are not null on cold start. */
export async function primeVectorWallScope(): Promise<void> {
  const now = Date.now();
  if (
    now - wallScope.fetchedAt < WALL_SCOPE_REFRESH_MS &&
    (fallbackStrikeTotals || fallbackVexStrikeTotals)
  ) {
    return;
  }
  if (!wallScopeInFlight) wallScopeInFlight = runWallScopeFetch();
  await wallScopeInFlight;
}

function refreshDarkPoolLevels(): void {
  const now = Date.now();
  if (now - cachedDarkPoolAt < DARK_POOL_REFRESH_MS || darkPoolInFlight) return;
  darkPoolInFlight = Promise.all([
    fetchUwDarkPool("SPX", { limit: 30, min_premium: 500_000 }).catch(() => null),
    fetchUwDarkPool("SPY", { limit: 30, min_premium: 500_000 }).catch(() => null),
  ])
    .then(([spx, spy]) => {
      const levels = darkPoolLevelsFromSnapshot(spx);
      cachedDarkPool =
        levels.length > 0 ? levels : darkPoolLevelsFromSnapshot(spy);
      cachedDarkPoolAt = Date.now();
    })
    .catch(() => {
      cachedDarkPoolAt = Date.now();
    })
    .finally(() => {
      darkPoolInFlight = null;
    });
}

/** Shared gamma-wall read for Vector SSE + SSR seed (UW WS + heatmap fallback). */
export function getVectorGexWalls(): GexWalls | null {
  refreshWallScope();
  const now = Date.now();
  if (now - cachedWallsAt < WALLS_CACHE_MS) return cachedWalls;

  const ws = getGexStrikeExpiryLadder("SPX", wallScope.expiries);
  if (ws) {
    cachedWalls = computeGexWalls(ws.ladder);
  } else if (fallbackStrikeTotals) {
    cachedWalls = computeGexWalls(mapFromStrikeTotalsRecord(fallbackStrikeTotals));
  } else {
    cachedWalls = null;
  }
  cachedWallsAt = now;
  return cachedWalls;
}

/** Vanna walls from the shared SPX heatmap cache (Polygon-derived, ~8s). */
export function getVectorVexWalls(): GexWalls | null {
  refreshWallScope();
  const now = Date.now();
  if (now - cachedVexWallsAt < VEX_WALLS_CACHE_MS) return cachedVexWalls;
  if (fallbackVexStrikeTotals && Object.keys(fallbackVexStrikeTotals).length > 0) {
    cachedVexWalls = computeGexWalls(mapFromStrikeTotalsRecord(fallbackVexStrikeTotals));
  } else {
    cachedVexWalls = null;
  }
  cachedVexWallsAt = now;
  return cachedVexWalls;
}

/** Zero-gamma flip from the shared GEX positioning cache (same as Thermal / SPX desk). */
export async function getVectorGammaFlip(): Promise<number | null> {
  const now = Date.now();
  if (now - cachedFlipAt < FLIP_CACHE_MS) return cachedFlip;
  try {
    const pos = await getGexPositioning("SPX");
    cachedFlip = pos?.flip ?? null;
  } catch {
    cachedFlip = null;
  }
  cachedFlipAt = now;
  return cachedFlip;
}

/** Zero-vanna flip from the latest heatmap scope refresh. */
export function getVectorVexFlip(): number | null {
  refreshWallScope();
  return cachedVexFlip;
}

export function getVectorDarkPoolLevels(): VectorDarkPoolLevel[] {
  refreshDarkPoolLevels();
  return cachedDarkPool;
}

export type VectorStreamPayload = {
  candle: ReturnType<typeof getCurrentSpxCandle>["current"];
  walls: GexWalls | null;
  vexWalls: GexWalls | null;
  gammaFlip: number | null;
  vexFlip: number | null;
  darkPoolLevels: VectorDarkPoolLevel[];
  t: number;
  wallHistory: WallHistorySample[];
  sessionYmd: string;
};

let wallHistory: WallHistorySample[] = [];

export function getVectorWallHistory(): WallHistorySample[] {
  return wallHistory;
}

export async function buildVectorStreamPayload(): Promise<VectorStreamPayload> {
  const { current, updatedAt } = getCurrentSpxCandle();
  const walls = getVectorGexWalls();
  const vexWalls = getVectorVexWalls();
  const gammaFlip = await getVectorGammaFlip();
  const vexFlip = getVectorVexFlip();
  const darkPoolLevels = getVectorDarkPoolLevels();
  const sessionYmd = todayEtYmd();

  if (walls || vexWalls) {
    const sampleTime = bucketWallSampleTime(Math.floor(Date.now() / 1000));
    const prev = wallHistory[wallHistory.length - 1];
    const sample: WallHistorySample = {
      time: sampleTime,
      walls: walls ?? prev?.walls ?? { callWalls: [], putWalls: [] },
      gammaFlip: gammaFlip ?? prev?.gammaFlip ?? null,
      vexWalls: vexWalls ?? prev?.vexWalls ?? null,
      vexFlip: vexFlip ?? prev?.vexFlip ?? null,
    };
    const hasGex =
      sample.walls.callWalls.length > 0 || sample.walls.putWalls.length > 0;
    const hasVex =
      Boolean(sample.vexWalls?.callWalls?.length) || Boolean(sample.vexWalls?.putWalls?.length);
    if (hasGex || hasVex) {
      wallHistory = recordWallSample(wallHistory, sample);
      persistWallSampleDebounced(sessionYmd, sample);
    }
  }

  return {
    candle: current,
    walls,
    vexWalls,
    gammaFlip,
    vexFlip,
    darkPoolLevels,
    t: updatedAt,
    wallHistory,
    sessionYmd,
  };
}

/** Test-only reset of module caches. */
export function _resetVectorSnapshotForTest(): void {
  wallScope = { expiries: undefined, fetchedAt: 0 };
  wallScopeInFlight = null;
  fallbackStrikeTotals = null;
  fallbackVexStrikeTotals = null;
  cachedVexFlip = null;
  cachedWalls = null;
  cachedWallsAt = 0;
  cachedVexWalls = null;
  cachedVexWallsAt = 0;
  cachedFlip = null;
  cachedFlipAt = 0;
  cachedDarkPool = [];
  cachedDarkPoolAt = 0;
  darkPoolInFlight = null;
  wallHistory = [];
}
