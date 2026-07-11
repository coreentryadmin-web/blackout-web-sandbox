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

/** 1s shared cache — Vector hub ticks at 1 Hz so stocks stay fresh without per-connection REST. */
const LIVE_CACHE_MS = 1_000;
const liveByTicker = new Map<string, LiveCache>();
const inflightByTicker = new Map<string, Promise<VectorLiveCandle | null>>();

function barFromAgg(b: { t?: number; o: number; h: number; l: number; c: number; v?: number }): VectorLiveCandle | null {
  // `o <= 0` is false for NaN — a malformed provider row with NaN OHLC fields
  // would otherwise poison the chart series (repo bug class: NaN passthrough).
  if (typeof b.t !== "number" || !(b.o > 0)) return null;
  if (!Number.isFinite(b.h) || !Number.isFinite(b.l) || !Number.isFinite(b.c)) return null;
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

  let inflight = inflightByTicker.get(t);
  if (!inflight) {
    inflight = fetchLatestMinuteBar(t).finally(() => {
      inflightByTicker.delete(t);
    });
    inflightByTicker.set(t, inflight);
  }
  const candle = await inflight;
  // updatedAt is FETCH freshness, not bar-start time: Polygon's latest closed
  // bar is up to ~2 min old the moment it's fetched, and stamping bar-start
  // made the payload's `t` (and the member-facing freshness chip) read stale
  // even when the fetch just succeeded.
  const fetchedAt = Date.now();
  const updatedAt = candle ? fetchedAt : 0;
  liveByTicker.set(t, { candle, updatedAt, fetchedAt });
  return { current: candle, updatedAt };
}

/** Test-only reset. */
export function _resetVectorLiveCandleForTest(): void {
  liveByTicker.clear();
  inflightByTicker.clear();
}
