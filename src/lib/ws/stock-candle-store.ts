/**
 * Per-ticker 1-minute OHLC candle aggregator for ALL non-SPX stock/ETF tickers,
 * fed tick-by-tick from Polygon stocks WS A (aggregate) events. Mirrors
 * spx-candle-store.ts but generalized to N tickers.
 *
 * Vector's live chart reads from here via getStockLiveCandle() — zero REST calls,
 * sub-second updates, exactly like SPX gets from spx-candle-store.ts.
 *
 * Cross-replica: the leader writes a per-ticker Redis snapshot; non-leaders read it.
 */
import { todayEtYmd } from "../providers/spx-session";
import { sharedCacheGet, sharedCacheSet } from "../shared-cache";

export type StockCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type CandleSnapshot = { current: StockCandle | null; updatedAt: number };

type TickerState = {
  current: StockCandle | null;
  sessionDate: string;
  updatedAt: number;
  lastRedisWriteAt: number;
};

const stores = new Map<string, TickerState>();

const REDIS_WRITE_THROTTLE_MS = 1_000;
const REDIS_READ_REFRESH_MS = 1_000;
const REDIS_TTL_SEC = 30;
const LOCAL_STALE_MS = 5_000;
const MAX_CANDLE_AGE_MS = 60_000;
const BAR_MS = 60_000;

function redisKey(ticker: string): string {
  return `vector:candle:stock:${ticker}`;
}

function getOrCreateState(ticker: string): TickerState {
  let s = stores.get(ticker);
  if (!s) {
    s = { current: null, sessionDate: "", updatedAt: 0, lastRedisWriteAt: 0 };
    stores.set(ticker, s);
  }
  return s;
}

/** Feed one live stock price tick into the per-ticker aggregator. */
export function recordStockTick(ticker: string, price: number, volume?: number, atMs: number = Date.now()): void {
  if (!Number.isFinite(price) || price <= 0) return;
  const sym = ticker.toUpperCase();
  const s = getOrCreateState(sym);

  const sessionDate = todayEtYmd();
  if (sessionDate !== s.sessionDate) {
    s.current = null;
    s.sessionDate = sessionDate;
  }

  const barTime = Math.floor(atMs / BAR_MS) * (BAR_MS / 1000);

  if (s.current && s.current.time === barTime) {
    s.current.high = Math.max(s.current.high, price);
    s.current.low = Math.min(s.current.low, price);
    s.current.close = price;
    if (volume != null && volume > 0) s.current.volume = volume;
  } else {
    if (s.current && barTime < s.current.time) return;
    s.current = { time: barTime, open: price, high: price, low: price, close: price, ...(volume != null && volume > 0 ? { volume } : {}) };
  }
  s.updatedAt = Date.now();

  // Throttled Redis write for cross-replica fallback
  if (s.updatedAt - s.lastRedisWriteAt >= REDIS_WRITE_THROTTLE_MS) {
    s.lastRedisWriteAt = s.updatedAt;
    void sharedCacheSet(
      redisKey(sym),
      { current: s.current, updatedAt: s.updatedAt } satisfies CandleSnapshot,
      REDIS_TTL_SEC,
    ).catch(() => {});
  }
}

// --- Read path (non-leader fallback) ---

type FallbackEntry = { snap: CandleSnapshot | null; fetchedAt: number; inflight: Promise<void> | null };
const fallbacks = new Map<string, FallbackEntry>();

function getFallback(ticker: string): FallbackEntry {
  let f = fallbacks.get(ticker);
  if (!f) {
    f = { snap: null, fetchedAt: 0, inflight: null };
    fallbacks.set(ticker, f);
  }
  return f;
}

function refreshFallback(ticker: string): void {
  const f = getFallback(ticker);
  const now = Date.now();
  if (now - f.fetchedAt < REDIS_READ_REFRESH_MS || f.inflight) return;
  f.inflight = sharedCacheGet<CandleSnapshot>(redisKey(ticker))
    .then((snap) => { if (snap) f.snap = snap; f.fetchedAt = Date.now(); })
    .catch(() => { f.fetchedAt = Date.now(); })
    .finally(() => { f.inflight = null; });
}

/** Read-only snapshot of the currently-forming bar for a stock ticker. */
export function getStockLiveCandle(ticker: string): CandleSnapshot {
  const sym = ticker.toUpperCase();
  const s = stores.get(sym);
  const local: CandleSnapshot | null = s?.current
    ? { current: s.current, updatedAt: s.updatedAt }
    : null;

  const localFresh = local != null && Date.now() - local.updatedAt <= LOCAL_STALE_MS;
  if (localFresh) return local;

  refreshFallback(sym);

  const fb = getFallback(sym);
  const best: CandleSnapshot | null =
    local && fb.snap && fb.snap.updatedAt > local.updatedAt ? fb.snap : local ?? fb.snap;

  if (!best) return { current: null, updatedAt: 0 };
  if (Date.now() - best.updatedAt > MAX_CANDLE_AGE_MS) {
    return { current: null, updatedAt: best.updatedAt };
  }
  return best;
}

/** Test-only reset. */
export function _resetStockCandleStoreForTest(): void {
  stores.clear();
  fallbacks.clear();
}
