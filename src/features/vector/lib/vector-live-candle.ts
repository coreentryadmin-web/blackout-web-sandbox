import type { UTCTimestamp } from "lightweight-charts";
import { getCurrentSpxCandle } from "@/lib/ws/spx-candle-store";
import { fetchIndexMinuteBars, fetchStockMinuteBars } from "@/lib/providers/polygon";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  isVectorIndexTicker,
  normalizeVectorTicker,
  vectorPolygonMinuteSymbol,
  VECTOR_DEFAULT_TICKER,
} from "./vector-ticker";

export type VectorLiveCandle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type LiveCache = { candle: VectorLiveCandle | null; updatedAt: number; fetchedAt: number };

const LIVE_CACHE_MS = 5_000;
const liveByTicker = new Map<string, LiveCache>();

function barFromAgg(b: { t?: number; o: number; h: number; l: number; c: number; v?: number }): VectorLiveCandle | null {
  if (typeof b.t !== "number" || b.o <= 0) return null;
  const time = Math.floor(b.t / 1000) as UTCTimestamp;
  return {
    time,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    ...(b.v != null && b.v > 0 ? { volume: b.v } : {}),
  };
}

async function fetchLatestMinuteBar(ticker: string): Promise<VectorLiveCandle | null> {
  const t = normalizeVectorTicker(ticker);
  const ymd = todayEtYmd();
  const sym = vectorPolygonMinuteSymbol(t);
  const bars = isVectorIndexTicker(t)
    ? await fetchIndexMinuteBars(sym, ymd, ymd).catch(() => [])
    : await fetchStockMinuteBars(t, ymd, ymd).catch(() => []);
  if (!bars.length) return null;
  const last = bars[bars.length - 1]!;
  return barFromAgg(last);
}

/** Live forming bar — SPX uses tick WS; other tickers poll Polygon minute bars (cached). */
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

  const now = Date.now();
  const cached = liveByTicker.get(t);
  if (cached && now - cached.fetchedAt < LIVE_CACHE_MS) {
    return { current: cached.candle, updatedAt: cached.updatedAt };
  }

  const candle = await fetchLatestMinuteBar(t);
  const updatedAt = candle ? candle.time * 1000 : 0;
  liveByTicker.set(t, { candle, updatedAt, fetchedAt: now });
  return { current: candle, updatedAt };
}

/** Test-only reset. */
export function _resetVectorLiveCandleForTest(): void {
  liveByTicker.clear();
}
