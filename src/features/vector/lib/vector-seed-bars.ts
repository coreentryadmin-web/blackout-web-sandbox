import type { UTCTimestamp } from "lightweight-charts";
import { formatEtDate, previousTradingDayEt } from "@/features/nighthawk/lib/session";
import { fetchIndexMinuteBars, fetchStockMinuteBars } from "@/lib/providers/polygon";
import { fetchSpyVolumeByMinute } from "./vector-spy-volume";
import {
  isVectorIndexTicker,
  normalizeVectorTicker,
  vectorPolygonMinuteSymbol,
  VECTOR_DEFAULT_TICKER,
} from "./vector-ticker";

export type VectorSeedBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  /** SPY 1m share volume aligned to SPX bars only. Stocks use native volume. */
  volume?: number;
};

type AggBar = { t?: number; o: number; h: number; l: number; c: number; v?: number };

function mapMinuteBars(bars: AggBar[], volumeByTime?: Map<number, number>): VectorSeedBar[] {
  return bars
    .filter((b) => typeof b.t === "number" && b.o > 0)
    .map((b) => {
      const time = Math.floor((b.t as number) / 1000) as UTCTimestamp;
      const volume = volumeByTime?.get(time) ?? (b.v != null && b.v > 0 ? b.v : undefined);
      return {
        time,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        ...(volume != null && volume > 0 ? { volume } : {}),
      };
    });
}

/**
 * Seed bars for the Vector chart: today's session first, then walk back through prior
 * trading days until Polygon returns data.
 */
export async function fetchVectorSeedBars(
  ticker: string = VECTOR_DEFAULT_TICKER,
  now = new Date(),
  fetchIndex: typeof fetchIndexMinuteBars = fetchIndexMinuteBars,
  fetchStock: typeof fetchStockMinuteBars = fetchStockMinuteBars,
  fetchSpyVolume: (ymd: string) => Promise<Map<number, number>> = fetchSpyVolumeByMinute
): Promise<{
  bars: VectorSeedBar[];
  sessionYmd: string;
  ticker: string;
}> {
  const t = normalizeVectorTicker(ticker);
  const today = formatEtDate(now);
  let ymd = today;
  const polySym = vectorPolygonMinuteSymbol(t);
  const useIndex = isVectorIndexTicker(t);

  for (let i = 0; i < 12; i++) {
    const rawBars = useIndex
      ? await fetchIndex(polySym, ymd, ymd).catch(() => [])
      : await fetchStock(t, ymd, ymd).catch(() => []);

    if (!rawBars.length) {
      ymd = previousTradingDayEt(ymd);
      continue;
    }

    let volumeByTime: Map<number, number> | undefined;
    if (t === "SPX") {
      volumeByTime = await fetchSpyVolume(ymd);
    }

    const mapped = mapMinuteBars(rawBars, volumeByTime);
    if (mapped.length > 0) return { bars: mapped, sessionYmd: ymd, ticker: t };
    ymd = previousTradingDayEt(ymd);
  }

  return { bars: [], sessionYmd: today, ticker: t };
}
