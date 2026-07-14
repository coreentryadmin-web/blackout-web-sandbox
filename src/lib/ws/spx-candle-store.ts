/**
 * In-memory 1-minute OHLC candle aggregator for SPX, fed tick-by-tick from the same
 * Polygon indices "V" channel that already updates `indexStore["I:SPX"].price` in
 * polygon-socket.ts. Powers the Vector live chart's current-bar updates — see
 * src/app/api/market/vector/stream/route.ts.
 *
 * Same shape-of-thinking as indexStore/darkPoolStore: a plain module-level store, no
 * class — this is a live view, not a source of truth (the initial historical bars a
 * client seeds from come from Polygon's own REST aggregates, see src/app/(site)/vector/page.tsx).
 *
 * Cross-replica fallback: recordSpxTick() only ever runs on whichever ONE replica
 * currently holds the Polygon indices WS leader lock (see polygon-socket.ts's leader
 * election) — every other replica's local `state` never receives a tick. Verified live
 * in production: a held-open SSE connection against a non-leader replica returned
 * `candle: null` for 20 consecutive ticks over 19s, while `/api/market/indices` (which
 * already has its own Redis `spx:pulse:snapshot` cross-replica fallback) showed a real
 * price throughout — confirming the gap is this store specifically, not a fleet-wide
 * outage. Mirrors that same pattern: the leader throttle-writes a Redis snapshot on tick;
 * every replica's read falls back to a slow-refreshed local copy of it when its own
 * local state is empty, so non-leaders show a live-ish (up to ~1s stale) candle instead
 * of permanently nothing.
 */
// Relative import (not the usual @/ alias): its test mocks this module, and
// node:test's mock.module() only reliably matches a specifier that's textually
// identical to the one used here — an aliased specifier resolved to a broken path
// in CI (see spx-candle-store.test.ts).
import { todayEtYmd } from "../providers/spx-session";
import { sharedCacheGet, sharedCacheSet } from "../shared-cache";

export type SpxCandle = {
  /** Bar start, epoch SECONDS (lightweight-charts' UTCTimestamp unit). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** SPY 1m share volume proxy — attached at stream boundary, not from tick aggregator. */
  volume?: number;
};

const BAR_MS = 60_000;
/** ~a session's worth of 1-minute bars (390 RTH minutes) plus pre/post-market headroom. */
const MAX_BARS = 600;

type CandleStoreState = {
  bars: SpxCandle[];
  current: SpxCandle | null;
  sessionDate: string;
  updatedAt: number;
};

const state: CandleStoreState = { bars: [], current: null, sessionDate: "", updatedAt: 0 };

function resetForNewSession(sessionDate: string): void {
  state.bars = [];
  state.current = null;
  state.sessionDate = sessionDate;
}

type CandleSnapshot = { current: SpxCandle | null; updatedAt: number };

const REDIS_KEY = "vector:candle:snapshot";
// Written on every tick on the leader, but throttled — the WS "V" channel can fire several
// times a second and this must not turn into a per-tick Redis write (matches the ~1s cadence
// polygon-socket.ts already uses for indexStore's own spx:pulse:snapshot).
const REDIS_WRITE_THROTTLE_MS = 1_000;
// How often a non-leader replica re-polls Redis for a fresher snapshot. Independent of
// REDIS_WRITE_THROTTLE_MS on purpose: this is a read-side cache to stop every concurrent SSE
// connection on the SAME non-leader replica from each hitting Redis on their own 1s tick.
const REDIS_READ_REFRESH_MS = 1_000;
const REDIS_TTL_SEC = 30;
/** When local state is older than this, prefer a fresher cross-replica Redis snapshot. */
const LOCAL_STALE_MS = 5_000;
/**
 * Absolute ceiling: never present a candle as live once BOTH local state and the Redis
 * fallback are older than this. Without this, a replica that lost the Polygon WS leader
 * lock keeps `state.current` frozen forever (it's a leftover write, never invalidated),
 * and if the fleet-wide Redis snapshot also has nothing fresher (leader outage, or this
 * replica's own reads keep missing), getCurrentSpxCandle() had no upper bound and would
 * confidently return that frozen value as "the current candle" no matter how old.
 * Confirmed live in prod: 10 concurrent SSE connections returned candles up to 15.8
 * minutes stale (some replicas fresh, others frozen), off by ~4.4 SPX points from the
 * real price — a materially wrong number presented with no staleness signal, on what's
 * meant to be a live chart. Mirrors the same pattern already used by
 * /api/market/quote/route.ts's WS_STALE_MS gate, which refuses stale local state outright
 * rather than serving it indefinitely. 60s is generous relative to normal leader-lock
 * renewal (seconds, not minutes) while still catching genuine fleet-wide gaps.
 */
const MAX_CANDLE_AGE_MS = 60_000;

let lastRedisWriteAt = 0;
let fallbackCandle: CandleSnapshot | null = null;
let fallbackFetchedAt = 0;
let fallbackInFlight: Promise<void> | null = null;

function throttledRedisWrite(): void {
  const now = Date.now();
  if (now - lastRedisWriteAt < REDIS_WRITE_THROTTLE_MS) return;
  lastRedisWriteAt = now;
  void sharedCacheSet(
    REDIS_KEY,
    { current: state.current, updatedAt: state.updatedAt },
    REDIS_TTL_SEC
  ).catch(() => {
    /* best-effort — the leader's own local state is still authoritative for its own reads */
  });
}

function refreshFallbackFromRedis(): void {
  const now = Date.now();
  if (now - fallbackFetchedAt < REDIS_READ_REFRESH_MS || fallbackInFlight) return;
  fallbackInFlight = sharedCacheGet<CandleSnapshot>(REDIS_KEY)
    .then((snap) => {
      if (snap) fallbackCandle = snap;
      fallbackFetchedAt = Date.now();
    })
    .catch(() => {
      fallbackFetchedAt = Date.now();
    })
    .finally(() => {
      fallbackInFlight = null;
    });
}

/** Feed one live SPX price tick into the aggregator. Called from polygon-socket.ts's "V" handler. */
export function recordSpxTick(price: number, atMs: number = Date.now()): void {
  if (!Number.isFinite(price) || price <= 0) return;

  const sessionDate = todayEtYmd();
  if (sessionDate !== state.sessionDate) resetForNewSession(sessionDate);

  const barTime = Math.floor(atMs / BAR_MS) * (BAR_MS / 1000);

  if (state.current && state.current.time === barTime) {
    state.current.high = Math.max(state.current.high, price);
    state.current.low = Math.min(state.current.low, price);
    state.current.close = price;
  } else {
    // Out-of-order guard: a late tick stamped with a PREVIOUS minute must not
    // rotate the forming bar. Without this, one late tick from minute M after
    // M+1 opened pushed the M+1 bar to history, made `current` an M-stamped
    // bar, and the next M+1 tick opened a FRESH M+1 bar whose open/high/low
    // were all that tick's price — silently erasing the true open and wicks
    // already printed for the forming minute on every connected client (the
    // client accepts equal-time candles as updates, so the rebuilt bar wins).
    if (state.current && barTime < state.current.time) return;
    if (state.current) {
      state.bars.push(state.current);
      if (state.bars.length > MAX_BARS) state.bars.splice(0, state.bars.length - MAX_BARS);
    }
    state.current = { time: barTime, open: price, high: price, low: price, close: price };
  }
  state.updatedAt = Date.now();
  throttledRedisWrite();
}

/**
 * Read-only snapshot of the currently-forming bar, for the Vector SSE stream. Local state
 * wins when it is fresh (leader actively ticking). When local `updatedAt` is stale — e.g. this
 * replica lost the Polygon WS leader lock but still holds yesterday's bar in memory — prefer
 * the cross-replica Redis snapshot written by whichever replica is currently leader.
 */
export function getCurrentSpxCandle(): CandleSnapshot {
  const local: CandleSnapshot | null = state.current
    ? { current: state.current, updatedAt: state.updatedAt }
    : null;

  const localFresh = local != null && Date.now() - local.updatedAt <= LOCAL_STALE_MS;
  if (localFresh) return local;

  refreshFallbackFromRedis();

  const best: CandleSnapshot | null =
    local && fallbackCandle && fallbackCandle.updatedAt > local.updatedAt ? fallbackCandle : local ?? fallbackCandle;

  if (!best) return { current: null, updatedAt: 0 };
  if (Date.now() - best.updatedAt > MAX_CANDLE_AGE_MS) {
    // Best available candle (local or fallback) is still too old to trust — refuse to
    // present it as live. Keep updatedAt so a caller can tell "no live data" from
    // "genuinely never ticked" if that's ever useful for diagnostics.
    return { current: null, updatedAt: best.updatedAt };
  }
  return best;
}

/** Test-only: reset all module state (local + fallback-cache bookkeeping). Not used in production. */
export function _resetSpxCandleStoreForTest(): void {
  state.bars = [];
  state.current = null;
  state.sessionDate = "";
  state.updatedAt = 0;
  lastRedisWriteAt = 0;
  fallbackCandle = null;
  fallbackFetchedAt = 0;
  fallbackInFlight = null;
}

/** Test-only: age local `updatedAt` to simulate a replica that lost the WS leader lock. */
export function _ageLocalCandleForTest(byMs: number): void {
  if (byMs > 0) state.updatedAt = Math.max(0, state.updatedAt - byMs);
}
