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

/** How many trading sessions of intraday context to seed (today + prior sessions). Members
 *  reported the chart "losing Friday" near the open: with a single session, today has only a
 *  handful of bars at 09:31 and the prior session is gone entirely. Three sessions gives a
 *  multi-day intraday backdrop without dragging in a wall of history. */
const TARGET_SEED_SESSIONS = 3;
/** Hard bar-count ceiling so a pathological run (e.g. a stock with sub-minute rows, or many
 *  short holiday sessions) can't balloon the seed. ~5 RTH sessions of 1m bars ≈ 1950; 3000 is
 *  comfortable headroom above the 3-session target. */
const MAX_SEED_BARS = 3000;
/** Walk-back budget in trading days — must exceed TARGET_SEED_SESSIONS enough to skip weekends
 *  and holidays while still collecting the target number of non-empty sessions. */
const MAX_SESSION_WALKBACK = 12;

/**
 * Seed bars for the Vector chart: the latest session (today, or the most recent trading day
 * when today has no bars yet — weekend/holiday/pre-open) PLUS up to TARGET_SEED_SESSIONS-1
 * prior trading sessions, concatenated oldest→newest with strictly ascending, de-duplicated
 * time so the chart draws genuine multi-day intraday context instead of a single session.
 *
 * `sessionYmd` remains the LATEST session's date (not the oldest) — every downstream
 * consumer (SSE/live upsert, session scoping, SPY-volume backfill, wall-history keying) keys
 * off it, so keeping it pinned to the newest session leaves all of that logic unchanged; only
 * the returned bar array grows to include prior-day context.
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

  // Collected newest-first as we walk back; emitted oldest-first below.
  const sessions: Array<{ ymd: string; bars: VectorSeedBar[] }> = [];
  let latestYmd: string | null = null;
  let totalBars = 0;

  for (let i = 0; i < MAX_SESSION_WALKBACK; i++) {
    if (sessions.length >= TARGET_SEED_SESSIONS || totalBars >= MAX_SEED_BARS) break;

    const rawBars = useIndex
      ? await fetchIndex(polySym, ymd, ymd).catch(() => [])
      : await fetchStock(t, ymd, ymd).catch(() => []);

    if (rawBars.length) {
      // SPX has no native tape volume — fetch SPY 1m volume per included session so prior-day
      // SPX bars carry volume too (the live backfill in VectorChart only refreshes sessionYmd).
      let volumeByTime: Map<number, number> | undefined;
      if (t === "SPX") volumeByTime = await fetchSpyVolume(ymd);

      const mapped = mapMinuteBars(rawBars, volumeByTime);
      if (mapped.length > 0) {
        // First non-empty session found is the latest one — today, or (walking back) the most
        // recent trading day when today has no bars yet. That's what sessionYmd must stay.
        if (latestYmd === null) latestYmd = ymd;
        sessions.push({ ymd, bars: mapped });
        totalBars += mapped.length;
      }
    }

    ymd = previousTradingDayEt(ymd);
  }

  if (!sessions.length) return { bars: [], sessionYmd: today, ticker: t };

  // Emit oldest-first so the chart draws left→right, and enforce strictly ascending unique
  // time across the session boundaries (defensive: drop any bar that isn't newer than the
  // last kept one, so a provider quirk can't produce a duplicate or backwards step).
  const bars: VectorSeedBar[] = [];
  let lastTime = Number.NEGATIVE_INFINITY;
  for (let s = sessions.length - 1; s >= 0; s--) {
    for (const bar of sessions[s]!.bars) {
      if (bar.time <= lastTime) continue;
      bars.push(bar);
      lastTime = bar.time;
    }
  }

  return { bars, sessionYmd: latestYmd!, ticker: t };
}
