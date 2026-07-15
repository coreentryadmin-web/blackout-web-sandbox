import type { UTCTimestamp } from "lightweight-charts";
import { getCurrentSpxCandle } from "@/lib/ws/spx-candle-store";
import { getStockLiveCandle } from "@/lib/ws/stock-candle-store";
import {
  normalizeVectorTicker,
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

/**
 * Live forming bar — ALL tickers now use Polygon WS (sub-second updates).
 * SPX reads from spx-candle-store (indices WS V channel).
 * Everything else reads from stock-candle-store (stocks WS A channel for
 * stocks/ETFs, indices WS A/V channels for non-SPX indices).
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
  return {
    current: snap.current as VectorLiveCandle | null,
    updatedAt: snap.updatedAt,
  };
}
