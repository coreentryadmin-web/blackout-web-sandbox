import { getGexStrikeExpiryLadder } from "@/lib/ws/uw-socket";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import {
  type VectorDarkPoolLevel,
} from "./vector-dark-pool-levels";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
  nextWallScope,
  type GexWalls,
  type WallScopeState,
} from "@/lib/providers/gex-wall-levels";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { persistWallSampleDebounced } from "./vector-wall-persist";
import { bucketWallSampleTime } from "./vector-wall-sample";
import { recordWallSample, type WallHistorySample } from "./vector-wall-history";
import { roundFloats } from "@/lib/round-floats";
import { getCachedVectorDarkPool } from "./vector-dark-pool-cache";
import { getVectorLiveCandle } from "./vector-live-candle";
import { spyVolumeForMinuteBar } from "./vector-spy-volume";
import {
  normalizeVectorTicker,
  VECTOR_DEFAULT_TICKER,
  vectorHasWsOracle,
} from "./vector-ticker";

const WALL_SCOPE_REFRESH_MS = 15_000;
const VEX_WALLS_CACHE_MS = 8_000;
const WALLS_CACHE_MS = 900;
const FLIP_CACHE_MS = 5_000;

type TickerState = {
  wallScope: WallScopeState;
  wallScopeInFlight: Promise<void> | null;
  fallbackStrikeTotals: Record<string, number> | null;
  fallbackVexStrikeTotals: Record<string, number> | null;
  cachedVexFlip: number | null;
  cachedWalls: GexWalls | null;
  cachedWallsAt: number;
  cachedVexWalls: GexWalls | null;
  cachedVexWallsAt: number;
  cachedFlip: number | null;
  cachedFlipAt: number;
  wallHistory: WallHistorySample[];
};

function freshState(): TickerState {
  return {
    wallScope: { expiries: undefined, fetchedAt: 0 },
    wallScopeInFlight: null,
    fallbackStrikeTotals: null,
    fallbackVexStrikeTotals: null,
    cachedVexFlip: null,
    cachedWalls: null,
    cachedWallsAt: 0,
    cachedVexWalls: null,
    cachedVexWallsAt: 0,
    cachedFlip: null,
    cachedFlipAt: 0,
    wallHistory: [],
  };
}

const stateByTicker = new Map<string, TickerState>();

function state(ticker: string): TickerState {
  const t = normalizeVectorTicker(ticker);
  let s = stateByTicker.get(t);
  if (!s) {
    s = freshState();
    stateByTicker.set(t, s);
  }
  return s;
}

function refreshWallScope(ticker: string): void {
  const s = state(ticker);
  const now = Date.now();
  if (now - s.wallScope.fetchedAt < WALL_SCOPE_REFRESH_MS || s.wallScopeInFlight) return;
  s.wallScopeInFlight = runWallScopeFetch(ticker);
}

function runWallScopeFetch(ticker: string): Promise<void> {
  const t = normalizeVectorTicker(ticker);
  const s = state(t);
  return fetchGexHeatmap(t)
    .then((hm) => {
      s.wallScope = nextWallScope(s.wallScope, Date.now(), hm);
      if (hm?.gex?.strike_totals && Object.keys(hm.gex.strike_totals).length > 0) {
        s.fallbackStrikeTotals = hm.gex.strike_totals;
      }
      if (hm?.vex?.strike_totals && Object.keys(hm.vex.strike_totals).length > 0) {
        s.fallbackVexStrikeTotals = hm.vex.strike_totals;
        s.cachedVexFlip = hm.vex.flip ?? null;
        s.cachedVexWalls = computeGexWalls(mapFromStrikeTotalsRecord(hm.vex.strike_totals));
        s.cachedVexWallsAt = Date.now();
      }
    })
    .catch(() => {
      s.wallScope = nextWallScope(s.wallScope, Date.now(), null);
    })
    .finally(() => {
      s.wallScopeInFlight = null;
    });
}

/** SSR / first paint — await heatmap scope so VEX walls are not null on cold start. */
export async function primeVectorWallScope(ticker: string = VECTOR_DEFAULT_TICKER): Promise<void> {
  const t = normalizeVectorTicker(ticker);
  const s = state(t);
  const now = Date.now();
  if (
    now - s.wallScope.fetchedAt < WALL_SCOPE_REFRESH_MS &&
    (s.fallbackStrikeTotals || s.fallbackVexStrikeTotals)
  ) {
    return;
  }
  if (!s.wallScopeInFlight) s.wallScopeInFlight = runWallScopeFetch(t);
  await s.wallScopeInFlight;
}

/** Shared gamma-wall read for Vector SSE + SSR seed (UW WS + heatmap fallback). */
export function getVectorGexWalls(ticker: string = VECTOR_DEFAULT_TICKER): GexWalls | null {
  const t = normalizeVectorTicker(ticker);
  const s = state(t);
  refreshWallScope(t);
  const now = Date.now();
  if (now - s.cachedWallsAt < WALLS_CACHE_MS) return s.cachedWalls;

  if (vectorHasWsOracle(t)) {
    const ws = getGexStrikeExpiryLadder(t, s.wallScope.expiries);
    if (ws) {
      s.cachedWalls = computeGexWalls(ws.ladder);
      s.cachedWallsAt = now;
      return s.cachedWalls;
    }
  }

  if (s.fallbackStrikeTotals) {
    s.cachedWalls = computeGexWalls(mapFromStrikeTotalsRecord(s.fallbackStrikeTotals));
  } else {
    s.cachedWalls = null;
  }
  s.cachedWallsAt = now;
  return s.cachedWalls;
}

/** Vanna walls from the shared heatmap cache (Polygon-derived, ~8s). */
export function getVectorVexWalls(ticker: string = VECTOR_DEFAULT_TICKER): GexWalls | null {
  const t = normalizeVectorTicker(ticker);
  const s = state(t);
  refreshWallScope(t);
  const now = Date.now();
  if (now - s.cachedVexWallsAt < VEX_WALLS_CACHE_MS) return s.cachedVexWalls;
  if (s.fallbackVexStrikeTotals && Object.keys(s.fallbackVexStrikeTotals).length > 0) {
    s.cachedVexWalls = computeGexWalls(mapFromStrikeTotalsRecord(s.fallbackVexStrikeTotals));
  } else {
    s.cachedVexWalls = null;
  }
  s.cachedVexWallsAt = now;
  return s.cachedVexWalls;
}

/** Zero-gamma flip from the shared GEX positioning cache. */
export async function getVectorGammaFlip(ticker: string = VECTOR_DEFAULT_TICKER): Promise<number | null> {
  const t = normalizeVectorTicker(ticker);
  const s = state(t);
  const now = Date.now();
  if (now - s.cachedFlipAt < FLIP_CACHE_MS) return s.cachedFlip;
  try {
    const pos = await getGexPositioning(t);
    s.cachedFlip = pos?.flip ?? null;
  } catch {
    s.cachedFlip = null;
  }
  s.cachedFlipAt = now;
  return s.cachedFlip;
}

/** Zero-vanna flip from the latest heatmap scope refresh. */
export function getVectorVexFlip(ticker: string = VECTOR_DEFAULT_TICKER): number | null {
  refreshWallScope(ticker);
  return state(ticker).cachedVexFlip;
}

/** Cache-reader — dark pool levels warmed by vector-dark-pool-warm cron. */
export async function getVectorDarkPoolLevels(
  ticker: string = VECTOR_DEFAULT_TICKER
): Promise<VectorDarkPoolLevel[]> {
  return getCachedVectorDarkPool(ticker);
}

export type VectorStreamPayload = {
  ticker: string;
  candle: Awaited<ReturnType<typeof getVectorLiveCandle>>["current"];
  walls: GexWalls | null;
  vexWalls: GexWalls | null;
  gammaFlip: number | null;
  vexFlip: number | null;
  darkPoolLevels: VectorDarkPoolLevel[];
  t: number;
  gexAsOf: number;
  vexAsOf: number;
  wallHistory: WallHistorySample[];
  sessionYmd: string;
};

export function getVectorWallHistory(ticker: string = VECTOR_DEFAULT_TICKER): WallHistorySample[] {
  return state(ticker).wallHistory;
}

export async function buildVectorStreamPayload(
  ticker: string = VECTOR_DEFAULT_TICKER
): Promise<VectorStreamPayload> {
  const t = normalizeVectorTicker(ticker);
  const s = state(t);
  const { current, updatedAt } = await getVectorLiveCandle(t);
  const walls = getVectorGexWalls(t);
  const vexWalls = getVectorVexWalls(t);
  const gammaFlip = await getVectorGammaFlip(t);
  const vexFlip = getVectorVexFlip(t);
  const darkPoolLevels = await getVectorDarkPoolLevels(t);
  const sessionYmd = todayEtYmd();

  if (walls || vexWalls) {
    const sampleTime = bucketWallSampleTime(Math.floor(Date.now() / 1000));
    const prev = s.wallHistory[s.wallHistory.length - 1];
    const sample: WallHistorySample = {
      time: sampleTime,
      walls: walls ?? prev?.walls ?? { callWalls: [], putWalls: [] },
      gammaFlip: gammaFlip ?? prev?.gammaFlip ?? null,
      vexWalls: vexWalls ?? prev?.vexWalls ?? null,
      vexFlip: vexFlip ?? prev?.vexFlip ?? null,
    };
    const hasGex = sample.walls.callWalls.length > 0 || sample.walls.putWalls.length > 0;
    const hasVex =
      Boolean(sample.vexWalls?.callWalls?.length) || Boolean(sample.vexWalls?.putWalls?.length);
    if (hasGex || hasVex) {
      s.wallHistory = recordWallSample(s.wallHistory, sample);
      persistWallSampleDebounced(sessionYmd, sample, t);
    }
  }

  let candle = current;
  if (current && t === "SPX") {
    const volume = await spyVolumeForMinuteBar(current.time);
    candle = volume != null ? { ...current, volume } : current;
  }

  return roundVectorStreamPayload({
    ticker: t,
    candle,
    walls,
    vexWalls,
    gammaFlip,
    vexFlip,
    darkPoolLevels,
    t: updatedAt,
    gexAsOf: s.cachedWallsAt,
    vexAsOf: s.cachedVexWallsAt,
    wallHistory: s.wallHistory,
    sessionYmd,
  });
}

export function roundVectorStreamPayload(payload: VectorStreamPayload): VectorStreamPayload {
  return roundFloats(payload);
}

/** Test-only reset of module caches. */
export function _resetVectorSnapshotForTest(): void {
  stateByTicker.clear();
}
