/**
 * Per-ticker 1-minute OHLC candle aggregator for ALL stocks/ETFs (and non-SPX
 * indices), fed tick-by-tick from the Polygon stocks WS `A.*` wildcard subscription
 * (~8 000 symbols, ~430 msgs/sec during RTH).
 *
 * Every page on the platform reads spot prices from here via getStockLiveCandle() —
 * zero REST calls, sub-second updates for any ticker Polygon streams.
 *
 * Cross-replica: Redis writes are ON-DEMAND — the leader only pushes a ticker's
 * snapshot to Redis when that ticker is actively being read (getStockLiveCandle
 * called). This keeps Redis writes proportional to tickers users are viewing
 * (~tens), not the full ~8K universe.
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
  /** True when someone has called getStockLiveCandle() for this ticker recently. */
  demanded: boolean;
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
    s = { current: null, sessionDate: "", updatedAt: 0, lastRedisWriteAt: 0, demanded: false };
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

  // On-demand Redis write: only push to Redis for tickers someone is actively
  // reading (getStockLiveCandle sets demanded=true). With A.* we get ~8K tickers;
  // writing all of them to Redis would be ~8K writes/sec — way too much. This
  // keeps it proportional to tickers users are actually viewing (~tens).
  if (s.demanded && s.updatedAt - s.lastRedisWriteAt >= REDIS_WRITE_THROTTLE_MS) {
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
  const s = getOrCreateState(sym);
  // Mark as demanded so recordStockTick writes this ticker to Redis for cross-replica fallback.
  s.demanded = true;
  const local: CandleSnapshot | null = s.current
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

/**
 * Quick WS spot price check — returns the latest close or null.
 * Marks the ticker as demanded (enables on-demand Redis writes for cross-replica
 * fallback) and checks freshness against maxAgeMs (default 60s).
 * Local-memory only — no Redis roundtrip, no async. Callers should fall through
 * to REST when this returns null.
 */
export function wsSpotPrice(ticker: string, maxAgeMs = 60_000): number | null {
  const sym = ticker.toUpperCase();
  const s = stores.get(sym);
  if (!s?.current || !(s.current.close > 0)) return null;
  if (Date.now() - s.updatedAt >= maxAgeMs) return null;
  s.demanded = true;
  return s.current.close;
}

/** How many tickers are in memory + how many are being written to Redis. */
export function getStockCandleStoreStats(): { total: number; demanded: number } {
  let demanded = 0;
  for (const s of stores.values()) if (s.demanded) demanded++;
  return { total: stores.size, demanded };
}

/** Test-only reset. */
export function _resetStockCandleStoreForTest(): void {
  stores.clear();
  fallbacks.clear();
}
