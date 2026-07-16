import type { UTCTimestamp } from "lightweight-charts";
import { getCurrentSpxCandle } from "@/lib/ws/spx-candle-store";
import { getStockLiveCandle } from "@/lib/ws/stock-candle-store";
import { fetchStockSnapshot, fetchIndexSnapshot } from "@/lib/providers/polygon";
import {
  normalizeVectorTicker,
  VECTOR_DEFAULT_TICKER,
  isVectorIndexTicker,
} from "./vector-ticker";

export type VectorLiveCandle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

// REST snapshot fallback — fire-and-forget background refresh so the 1Hz SSE
// poll never blocks on a network roundtrip.  Same pattern as stock-candle-store's
// Redis fallback: return whatever the cache has NOW, kick a refresh if stale.
type RestFallbackEntry = {
  candle: VectorLiveCandle | null;
  updatedAt: number;
  fetchedAt: number;
};
const restFallback = new Map<string, RestFallbackEntry>();
const restInflight = new Map<string, Promise<void>>();
const REST_REFRESH_MS = 5_000;
const REST_MAX_AGE_MS = 120_000;

function refreshRestFallback(ticker: string): void {
  const entry = restFallback.get(ticker);
  const now = Date.now();
  if (entry && now - entry.fetchedAt < REST_REFRESH_MS) return;
  if (restInflight.has(ticker)) return;

  const task = (async () => {
    try {
      const isIdx = isVectorIndexTicker(ticker);
      const snap = isIdx
        ? await fetchIndexSnapshot(`I:${ticker}`)
        : await fetchStockSnapshot(ticker);
      const price = snap?.price;
      if (price && price > 0) {
        const barSec = Math.floor(now / 60_000) * 60;
        restFallback.set(ticker, {
          candle: {
            time: barSec as UTCTimestamp,
            open: price,
            high: price,
            low: price,
            close: price,
          },
          updatedAt: now,
          fetchedAt: now,
        });
      } else {
        restFallback.set(ticker, {
          candle: entry?.candle ?? null,
          updatedAt: entry?.updatedAt ?? 0,
          fetchedAt: now,
        });
      }
    } catch {
      restFallback.set(ticker, {
        candle: entry?.candle ?? null,
        updatedAt: entry?.updatedAt ?? 0,
        fetchedAt: now,
      });
    } finally {
      restInflight.delete(ticker);
    }
  })();
  restInflight.set(ticker, task);
  if (restFallback.size > 200) restFallback.clear();
}

function getRestFallbackCandle(ticker: string): {
  current: VectorLiveCandle | null;
  updatedAt: number;
} {
  refreshRestFallback(ticker);
  const entry = restFallback.get(ticker);
  if (!entry?.candle || Date.now() - entry.updatedAt > REST_MAX_AGE_MS) {
    return { current: null, updatedAt: entry?.updatedAt ?? 0 };
  }
  return { current: entry.candle, updatedAt: entry.updatedAt };
}

/**
 * Live forming bar — ALL tickers now use Polygon WS (sub-second updates).
 * SPX reads from spx-candle-store (indices WS V channel).
 * Everything else reads from stock-candle-store (stocks WS A channel for
 * stocks/ETFs, indices WS A/V channels for non-SPX indices).
 *
 * When the WS store is empty (off-hours, cold start, WS not connected),
 * falls back to a throttled REST snapshot (~5s refresh) so the spot price
 * stays alive instead of going dark.
 */
export async function getVectorLiveCandle(ticker: string = VECTOR_DEFAULT_TICKER): Promise<{
  current: VectorLiveCandle | null;
  updatedAt: number;
}> {
  const t = normalizeVectorTicker(ticker);

  if (t === "SPX") {
    const snap = getCurrentSpxCandle();
    return {
      current: snap.current as VectorLiveCandle | null,
      updatedAt: snap.updatedAt,
    };
  }

  const snap = getStockLiveCandle(t);
  if (snap.current) {
    return {
      current: snap.current as VectorLiveCandle | null,
      updatedAt: snap.updatedAt,
    };
  }

  // WS store empty — REST fallback keeps the spot alive at ~5s cadence
  return getRestFallbackCandle(t);
}
