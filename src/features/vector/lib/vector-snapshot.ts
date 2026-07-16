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
  wallsHaveNodes,
  type GexWalls,
  type WallScopeState,
} from "@/lib/providers/gex-wall-levels";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { persistWallSampleDebounced, loadSessionWallHistory } from "./vector-wall-persist";
import { bucketWallSampleTime, buildWallHistorySample } from "./vector-wall-sample";
import {
  RECORDED_WALL_HORIZONS,
  pickNarrowedWallSample,
  type NarrowedWallOutcome,
} from "./vector-narrowed-wall-core";
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
import { getPerExpiryGexWalls } from "./vector-dte-walls-server";
import { VECTOR_WALL_NODES_PER_SIDE } from "./vector-bar-timeframes";

const WALL_SCOPE_REFRESH_MS = 5_000;
const VEX_WALLS_CACHE_MS = 4_000;
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
  /**
   * Last 5s bucket for which the narrowed-horizon (0dte/weekly/monthly) rails were recorded from
   * this live hub. The hub previously wrote ONLY the "all" rail — narrowed rails were cron-only
   * (5-min cadence), so a member watching the 0DTE lens saw a frozen rail. Gating the per-horizon
   * write on a bucket rollover gives viewed narrowed rails the same 5s density as "all" without
   * recomputing per-expiry walls on every 1s payload build.
   */
  lastNarrowedWallBucket: number;
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
    lastNarrowedWallBucket: 0,
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
        s.cachedVexWalls = computeGexWalls(mapFromStrikeTotalsRecord(hm.vex.strike_totals), {
          maxPerSide: VECTOR_WALL_NODES_PER_SIDE,
        });
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
      s.cachedWalls = computeGexWalls(ws.ladder, { maxPerSide: VECTOR_WALL_NODES_PER_SIDE });
      s.cachedWallsAt = now;
      return s.cachedWalls;
    }
  }

  if (s.fallbackStrikeTotals) {
    s.cachedWalls = computeGexWalls(mapFromStrikeTotalsRecord(s.fallbackStrikeTotals), {
      maxPerSide: VECTOR_WALL_NODES_PER_SIDE,
    });
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

/** Vanna walls from the shared heatmap cache (Polygon-derived, ~5s). */
export function getVectorVexWalls(ticker: string = VECTOR_DEFAULT_TICKER): GexWalls | null {
  const t = normalizeVectorTicker(ticker);
  const s = state(t);
  refreshWallScope(t);
  const now = Date.now();
  if (now - s.cachedVexWallsAt < VEX_WALLS_CACHE_MS) return s.cachedVexWalls;
  if (s.fallbackVexStrikeTotals && Object.keys(s.fallbackVexStrikeTotals).length > 0) {
    s.cachedVexWalls = computeGexWalls(mapFromStrikeTotalsRecord(s.fallbackVexStrikeTotals), {
      maxPerSide: VECTOR_WALL_NODES_PER_SIDE,
    });
    s.cachedVexWallsAt = s.fallbackFetchedAt;
  } else {
    s.cachedVexWalls = null;
    s.cachedVexWallsAt = now;
  }
  return s.cachedVexWalls;
}

/**
 * GEX walls scoped to a DTE horizon (timeframe/expiry-aware walls).
 *
 * Two per-expiry data sources, both real (no fabrication):
 *  - ORACLE tickers (SPX/SPY/QQQ) slice the live UW per-expiry gamma ladder
 *    (`getGexStrikeExpiryLadder(ticker, expiries)`) to the horizon's expiries.
 *  - EVERY OTHER optionable ticker now computes per-expiry walls from the Polygon
 *    options chain (per-contract expiry + OI + IV → BSM GEX ladder at spot), via
 *    `getPerExpiryGexWalls`. This is the "DTE for all tickers" path: previously
 *    non-oracle tickers had no per-expiry breakdown and the toggle was hidden.
 *
 * The "all" horizon short-circuits to the existing blended near-term aggregate
 * (`getVectorGexWalls`) for BOTH paths — it's the fast, already-warmed read and
 * needs no chain fetch. Every narrowing falls back to that same blended aggregate
 * rather than ever returning null walls, so the overlay never blanks just because a
 * horizon was empty, the WS ladder hasn't populated, or a chain fetch hiccuped.
 *
 * Intentionally NOT on the per-second stream path — it's an on-demand read behind
 * the DTE toggle; the non-oracle chain fetch is Redis-cached (10min) so repeated
 * toggles don't re-hit Polygon.
 */
export async function getVectorGexWallsForHorizon(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<GexWalls | null> {
  const t = normalizeVectorTicker(ticker);

  // "all" is the fast, already-warmed blended aggregate for every ticker — no chain fetch.
  if (horizon === "all") {
    const warm = getVectorGexWalls(t);
    if (wallsHaveNodes(warm)) return warm;
    // Cold-task safety net. getVectorGexWalls is a SYNCHRONOUS in-memory read: on a freshly
    // spun serverless task the UW WS ladder isn't connected and s.fallbackStrikeTotals hasn't
    // been populated yet (getVectorGexWalls → refreshWallScope kicks off the heatmap fetch but
    // returns BEFORE it resolves), so the first call returns null/empty walls. The companion
    // getVectorGammaFlipForHorizon("all") is fetch-backed (getVectorGammaFlip → getGexPositioning),
    // so /api/market/vector/walls?dte=all could answer with a real flip and ZERO walls — a member
    // toggling the DTE control to "All" would watch the beads/walls blank out intermittently
    // depending on which task the request lands on. primeVectorWallScope AWAITS the same heatmap
    // fetch (populating s.fallbackStrikeTotals from hm.gex.strike_totals), restoring the wall/flip
    // symmetry the narrowed-horizon and oracle branches below already have. Warm tasks never reach
    // here — the guard above returns first — so the hot SSE path is untouched.
    await primeVectorWallScope(t);
    const primed = getVectorGexWalls(t);
    if (wallsHaveNodes(primed)) return primed;

    // Heatmap STILL empty after priming. Before recomputing from the chain, read the LAST RECORDED
    // rail sample from shared Redis — that is literally the blended wall set the live stream showed
    // members ≤15s ago, so a cold API task answers "All" with the SAME numbers every stream-fed
    // surface (banner/kings/beads) is already displaying. Without this, the cold path jumped to an
    // all-expiry CHAIN aggregate — a different definition of "All" — and cross-surface checks caught
    // it live (DTE grind 2026-07-13: ASTS banner resistance 75 vs dte=all API 90, TSLA support
    // 392.5 vs 380). Coherence beats recomputation; the chain stays as the last resort for tickers
    // with no recorded rail this session (first view off-hours etc.).
    const railTail = await loadSessionWallHistory(todayEtYmd(), t)
      .then((h) => h[h.length - 1] ?? null)
      .catch(() => null);
    if (railTail?.walls && wallsHaveNodes(railTail.walls)) return railTail.walls;

    // Last resort: recompute from the chain over the near-term expiry set — proven live 2026-07-12
    // (ASTS/PLTR/UBER/NVDA: heatmap empty on a cold task while every narrowed horizon returned
    // 12/12 via the per-expiry chain on the same request). Guarantees "All" is never blank when the
    // chain has data.
    const chain = await getPerExpiryGexWalls(t, "all").catch(() => null);
    if (chain?.walls && wallsHaveNodes(chain.walls)) return chain.walls;
    return primed; // honest: return whatever we have (possibly empty) rather than throw
  }

  // NARROWED HORIZON — per-expiry walls from the Polygon options chain, for EVERY ticker
  // including the oracles (SPX/SPY/QQQ all have option chains: SPX via I:SPX index options,
  // SPY/QQQ via their equity chains). This is the path that ACTUALLY re-scopes by expiry.
  //
  // Why the chain path leads even for oracles: the UW per-expiry WS ladder
  // (`getGexStrikeExpiryLadder`) is served per-process from the socket store, but the DTE
  // toggle fires a fresh `/api/market/vector/walls?dte=` request that can land on any task —
  // and there the horizon-sliced ladder came back IDENTICAL for 0dte/weekly/monthly (audit:
  // SPX showed call 7575 / put 7475 / flip 7495.51 for all three), so the toggle was inert on
  // the three flagship tickers. The chain recompute (same BSM the stocks use) genuinely
  // narrows, so it takes precedence; the WS ladder stays a fallback below.
  const perExpiry = await getPerExpiryGexWalls(t, horizon).catch(() => null);
  if (perExpiry?.walls && (perExpiry.walls.callWalls.length || perExpiry.walls.putWalls.length)) {
    return perExpiry.walls;
  }

  // ORACLE fallback: the UW per-expiry WS ladder sliced to the horizon, if the chain path was
  // empty (e.g. Polygon options snapshot unavailable for the index root). Better than the
  // blended aggregate when it exists, and it never regresses below the prior behavior.
  if (vectorHasWsOracle(t)) {
    await primeVectorWallScope(t);
    const s = state(t);
    const scoped = expiriesForHorizon(s.wallScope.expiries ?? [], horizon, todayEtYmd());
    if (scoped.length) {
      const ws = getGexStrikeExpiryLadder(t, scoped);
      if (ws && ws.ladder.size > 0) {
        return computeGexWalls(ws.ladder, { maxPerSide: VECTOR_WALL_NODES_PER_SIDE });
      }
    }
  }

  return getVectorGexWalls(t); // honest fallback: never blank the walls
}

/**
 * Gamma flip scoped to a DTE horizon — the companion to getVectorGexWallsForHorizon so the
 * gamma-flip overlay line re-scopes with the toggle too, not just the walls.
 *
 * For the "all" horizon this is the canonical near-term flip (`getVectorGammaFlip`) — the
 * whole-chain view. For a narrowed horizon (ANY ticker, oracle included) it's the flip derived
 * from the SAME per-expiry chain ladder the walls came from (shares getPerExpiryGexWalls's short
 * memo, so this is not a second chain fetch), falling back to the near-term flip when the
 * per-expiry ladder yields no crossing.
 *
 * Oracles used to short-circuit here (return the near-term flip for every horizon), which — with
 * the walls path also collapsing — left the DTE toggle fully inert on SPX/SPY/QQQ. Routing the
 * oracle flip through the per-expiry chain (the same source the walls now use) makes the flip
 * line re-scope with the toggle on the flagship tickers too.
 */
export async function getVectorGammaFlipForHorizon(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<number | null> {
  const t = normalizeVectorTicker(ticker);
  if (horizon === "all") return getVectorGammaFlip(t);
  const perExpiry = await getPerExpiryGexWalls(t, horizon).catch(() => null);
  return perExpiry?.flip ?? getVectorGammaFlip(t);
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

// ── Narrowed-horizon wall recording (shared by the live 5s hub and the 5-min universe cron) ──
// Root cause of the "frozen 0DTE rail" bug: narrowed rails (0dte/weekly/monthly) were written ONLY
// by the universe cron (5-min cadence, best-effort with a silent skip when the per-expiry SPXW
// reconstruction came back empty), while the live hub wrote only the blended "all" rail. So a
// member watching the 0DTE lens saw new walls at best every ~5 min — and for SPX far less, because
// its per-expiry reconstruction empties out on most cron ticks. Both writers now share this path so
// the rail (a) advances at the live 5s cadence when a ticker is viewed, and (b) FALLS BACK to the
// blended near-term walls when the per-expiry reconstruction is momentarily empty (the documented
// "null → blended near-term walls" contract) instead of dropping the bucket.

/**
 * Fetch + build the narrowed-horizon wall samples for a ticker at one bucket time. `blended` is the
 * caller's current "all"/near-term reading (the hub passes its warm in-memory walls; the cron passes
 * the heatmap walls it just computed) — used as the fallback when a horizon's per-expiry
 * reconstruction is empty. Best-effort per horizon: a throw becomes an "error" outcome (logged by
 * the caller), never propagates. Callers persist the non-null samples with their own semantics
 * (debounced for the hub, awaited for the cron).
 */
export async function buildNarrowedHorizonWallSamples(
  ticker: string,
  sampleTime: number,
  blended: { walls: GexWalls | null; flip: number | null }
): Promise<NarrowedWallOutcome[]> {
  const t = normalizeVectorTicker(ticker);
  const out: NarrowedWallOutcome[] = [];
  for (const horizon of RECORDED_WALL_HORIZONS) {
    try {
      const [hWalls, hFlip] = await Promise.all([
        getVectorGexWallsForHorizon(t, horizon),
        getVectorGammaFlipForHorizon(t, horizon),
      ]);
      const picked = pickNarrowedWallSample({
        time: sampleTime,
        horizonWalls: hWalls,
        horizonFlip: hFlip,
        blendedWalls: blended.walls,
        blendedFlip: blended.flip,
      });
      out.push({ horizon, sample: picked.sample, source: picked.source });
    } catch (err) {
      out.push({
        horizon,
        sample: null,
        source: "error",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
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

    // Narrowed-horizon rails (0dte/weekly/monthly) at the live 5s cadence. Previously these were
    // written ONLY by the 5-min universe cron, so a viewed 0DTE lens showed a frozen rail. Gate on
    // a bucket rollover so the per-expiry walls are computed at most once per 5s bucket, and
    // fire-and-forget so the hot SSE payload never blocks or breaks on the rail write. `walls` is
    // this bucket's fresh blended near-term reading — the fallback when a horizon's per-expiry
    // reconstruction is momentarily empty (keeps the rail advancing instead of dropping the bucket).
    const narrowedBucket = bucketWallSampleTime(Math.floor(nowMs / 1000));
    if (gexRecordable && s.lastNarrowedWallBucket !== narrowedBucket) {
      s.lastNarrowedWallBucket = narrowedBucket;
      void buildNarrowedHorizonWallSamples(t, narrowedBucket, { walls, flip: gammaFlip })
        .then((rows) => {
          for (const r of rows) {
            if (r.sample) persistWallSampleDebounced(sessionYmd, r.sample, t, r.horizon);
          }
        })
        .catch(() => {
          /* best-effort: a narrowed-rail write must never disturb the live stream */
        });
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
