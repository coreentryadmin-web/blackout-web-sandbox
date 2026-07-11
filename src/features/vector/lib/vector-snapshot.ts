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
import { bucketWallSampleTime, buildWallHistorySample } from "./vector-wall-sample";
import { recordWallSample, type WallHistorySample } from "./vector-wall-history";
import { roundFloats } from "@/lib/round-floats";
import { getCachedVectorDarkPool, getCachedVectorDarkPoolWithAge } from "./vector-dark-pool-cache";
import { getVectorLiveCandle } from "./vector-live-candle";
import { spyVolumeForMinuteBar } from "./vector-spy-volume";
import {
  normalizeVectorTicker,
  VECTOR_DEFAULT_TICKER,
  vectorHasWsOracle,
} from "./vector-ticker";
import { expiriesForHorizon, type VectorDteHorizon } from "./vector-dte-horizon";

const WALL_SCOPE_REFRESH_MS = 15_000;
const VEX_WALLS_CACHE_MS = 8_000;
const WALLS_CACHE_MS = 900;
const FLIP_CACHE_MS = 5_000;

type TickerState = {
  wallScope: WallScopeState;
  wallScopeInFlight: Promise<void> | null;
  fallbackStrikeTotals: Record<string, number> | null;
  /** When the heatmap data behind the fallbacks was actually fetched — drives honest gexAsOf/vexAsOf during outages. */
  fallbackFetchedAt: number;
  fallbackVexStrikeTotals: Record<string, number> | null;
  cachedVexFlip: number | null;
  cachedWalls: GexWalls | null;
  cachedWallsAt: number;
  cachedVexWalls: GexWalls | null;
  cachedVexWallsAt: number;
  cachedFlip: number | null;
  cachedFlipAt: number;
  wallHistory: WallHistorySample[];
  /** ET session the in-memory history belongs to — see session reset in buildVectorStreamPayload. */
  sessionYmd: string;
};

function freshState(): TickerState {
  return {
    wallScope: { expiries: undefined, fetchedAt: 0 },
    wallScopeInFlight: null,
    fallbackStrikeTotals: null,
    fallbackFetchedAt: 0,
    fallbackVexStrikeTotals: null,
    cachedVexFlip: null,
    cachedWalls: null,
    cachedWallsAt: 0,
    cachedVexWalls: null,
    cachedVexWallsAt: 0,
    cachedFlip: null,
    cachedFlipAt: 0,
    wallHistory: [],
    sessionYmd: "",
  };
}

const stateByTicker = new Map<string, TickerState>();
/**
 * Cap on distinct per-ticker states kept in memory. Vector now serves ANY
 * optionable symbol on demand (not just the ~21 preset universe), so without a
 * bound a client cycling invented-but-well-formed tickers could grow this map
 * without limit — the exact concern the stream route's old universe gate cited.
 * 64 comfortably holds the preset universe plus every symbol under active view
 * with headroom; least-recently-used entries beyond it are evicted (their walls
 * simply re-fetch on next access). The concurrent-poller count is separately
 * capped by tryAcquireVectorStreamConnection.
 */
const MAX_TICKER_STATES = 64;

function state(ticker: string): TickerState {
  const t = normalizeVectorTicker(ticker);
  const existing = stateByTicker.get(t);
  if (existing) {
    // LRU touch: re-insert so this ticker moves to the newest slot and the
    // eviction below drops genuinely cold tickers, not one just being viewed.
    stateByTicker.delete(t);
    stateByTicker.set(t, existing);
    return existing;
  }
  const s = freshState();
  stateByTicker.set(t, s);
  if (stateByTicker.size > MAX_TICKER_STATES) {
    const oldest = stateByTicker.keys().next().value; // Map preserves insertion order → front is LRU
    if (oldest !== undefined) stateByTicker.delete(oldest);
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
        s.fallbackFetchedAt = Date.now();
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
    // gexAsOf must report DATA age, not compute time: during a provider outage
    // the fallback never refreshes, and stamping "now" here made members see
    // indefinitely-fresh age chips over walls that stopped updating.
    s.cachedWallsAt = s.fallbackFetchedAt;
  } else {
    s.cachedWalls = null;
    s.cachedWallsAt = now;
  }
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
    s.cachedVexWallsAt = s.fallbackFetchedAt;
  } else {
    s.cachedVexWalls = null;
    s.cachedVexWallsAt = now;
  }
  return s.cachedVexWalls;
}

/**
 * GEX walls scoped to a DTE horizon (Phase 2 — timeframe/expiry-aware walls).
 *
 * Only oracle tickers (SPX/SPY/QQQ) carry the per-expiry gamma ladder needed to
 * re-scope by expiry (`getGexStrikeExpiryLadder(ticker, expiries)`); for every
 * other ticker the walls come from the heatmap fallback, which is already a
 * near-term blend with no per-expiry breakdown to slice. So for non-oracle
 * tickers — and for the "all" horizon — this returns the same walls as
 * `getVectorGexWalls`. Every narrowing also falls back to the default rather
 * than ever returning null walls, so the overlay never blanks just because a
 * horizon was empty or the WS ladder hasn't populated yet.
 *
 * Intentionally NOT cached per-horizon and NOT on the per-second stream path —
 * it's an on-demand read behind the DTE toggle, so it awaits the wall scope
 * (expiry list) rather than racing a background refresh.
 */
export async function getVectorGexWallsForHorizon(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<GexWalls | null> {
  const t = normalizeVectorTicker(ticker);
  if (horizon === "all" || !vectorHasWsOracle(t)) return getVectorGexWalls(t);
  await primeVectorWallScope(t);
  const s = state(t);
  const scoped = expiriesForHorizon(s.wallScope.expiries ?? [], horizon, todayEtYmd());
  if (!scoped.length) return getVectorGexWalls(t);
  const ws = getGexStrikeExpiryLadder(t, scoped);
  if (!ws || ws.ladder.size === 0) return getVectorGexWalls(t);
  return computeGexWalls(ws.ladder);
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
  /** When the dark-pool snapshot behind the levels was fetched (0 = unknown/legacy). */
  darkPoolAsOf: number;
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
  const darkPool = await getCachedVectorDarkPoolWithAge(t);
  const sessionYmd = todayEtYmd();

  // Session boundary: a process surviving close→open (weekend, overnight viewer)
  // must not stitch the previous session's tail next to today's first sample —
  // that fabricated a "wall shifted" event at the open and made the replay
  // timeline span two sessions. History is per-session; Redis persistence keys
  // by ymd already, and the fresh day's page seed loads the fresh day's key.
  if (s.sessionYmd !== sessionYmd) {
    s.wallHistory = [];
    s.sessionYmd = sessionYmd;
  }

  // Refuse to record fallback-sourced readings older than the discontinuity
  // window into history: during a provider outage the fallback stops
  // refreshing, and re-recording the same stale walls under fresh bucket times
  // fabricates a flat trail that was never observed (and persists it).
  const STALE_RECORD_MAX_MS = 120_000;
  const nowMs = Date.now();
  const gexRecordable = walls != null && nowMs - s.cachedWallsAt <= STALE_RECORD_MAX_MS;
  const vexRecordable = vexWalls != null && nowMs - s.cachedVexWallsAt <= STALE_RECORD_MAX_MS;

  if (gexRecordable || vexRecordable) {
    // Same sample builder the server-side universe recorder uses, so the two
    // writers of vector:wall-history produce byte-identical rows (rounding +
    // honest-gap semantics documented on buildWallHistorySample). Freshness
    // gating stays here: a lens whose cache is stale contributes nothing this
    // bucket (passed as null), recording an honest gap rather than a stale copy.
    const sample = buildWallHistorySample({
      time: bucketWallSampleTime(Math.floor(nowMs / 1000)),
      gexWalls: gexRecordable ? walls : null,
      gammaFlip: gexRecordable ? gammaFlip : null,
      vexWalls: vexRecordable ? vexWalls : null,
      vexFlip: vexRecordable ? vexFlip : null,
    });
    if (sample) {
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
    darkPoolLevels: darkPool.levels,
    darkPoolAsOf: darkPool.fetchedAt,
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
