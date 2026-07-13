import type { UTCTimestamp } from "lightweight-charts";
import { formatEtDate, previousTradingDayEt } from "@/features/nighthawk/lib/session";
import { fetchIndexMinuteBars, fetchStockMinuteBars } from "@/lib/providers/polygon";
import { fetchSpyVolumeByMinute } from "./vector-spy-volume";
import { aggregateVectorBars } from "./vector-bar-timeframes";
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

/** How many trading sessions of intraday context to seed (today + prior sessions). 15 sessions
 *  is the multi-day replay depth ("store at least 15 days of chart, wall, bead history"): the
 *  chart, wall rail, and replay timeline all derive from these bars, so this is the horizon a
 *  member can scrub back through. Cost is contained by (a) parallel per-day fetches, (b) 5-min
 *  decimation of sessions older than the newest FULL_RES_SESSIONS, and (c) callers that don't
 *  need depth (bars route reconnect backfill, server technicals) passing a smaller
 *  targetSessions explicitly. */
const TARGET_SEED_SESSIONS = 15;
/** Newest sessions kept at native 1m resolution; older sessions are decimated to 5m bars.
 *  3 matches the pre-multi-day seed depth exactly, so every ≤3-session caller (bars route,
 *  server technicals) sees byte-identical output to before — the decimation only ever applies
 *  to the deep prior-day context the 15-session page seed adds. */
const FULL_RES_SESSIONS = 3;
/** Hard bar-count ceiling (applied AFTER prior-session decimation) so a pathological run can't
 *  balloon the seed/SSR payload. 15 RTH sessions ≈ 3×390 (1m) + 12×78 (5m) ≈ 2106; a liquid
 *  stock with extended-hours minute rows ≈ 3×960 + 12×192 ≈ 5184; 6500 is headroom above both.
 *  When the cap trims, whole OLDEST sessions are dropped first — never a partial session. */
const MAX_SEED_BARS = 6500;
/** Walk-back budget in trading days — must exceed TARGET_SEED_SESSIONS enough to skip data-gap
 *  days (previousTradingDayEt already skips weekends/holidays) while still collecting the
 *  target number of non-empty sessions. */
const MAX_SESSION_WALKBACK = 25;
/** Decimated interval for sessions older than FULL_RES_SESSIONS (see barsForVectorTimeframe). */
const PRIOR_SESSION_BAR_MINUTES = 5;

/**
 * Seed bars for the Vector chart: the latest session (today, or the most recent trading day
 * when today has no bars yet — weekend/holiday/pre-open) PLUS up to targetSessions-1 prior
 * trading sessions, concatenated oldest→newest with strictly ascending, de-duplicated time so
 * the chart draws genuine multi-day intraday context instead of a single session. The newest
 * FULL_RES_SESSIONS keep 1m bars; older sessions are aggregated to 5m (payload: 15 sessions of
 * raw 1m is ~600KB of JSON before wall history — the decimated shape is ~1/3 of that while a
 * 5m candle at replay zoom is indistinguishable for prior-day context).
 *
 * `sessionYmd` remains the LATEST session's date (not the oldest) — every downstream
 * consumer (SSE/live upsert, session scoping, SPY-volume backfill, wall-history keying) keys
 * off it, so keeping it pinned to the newest session leaves all of that logic unchanged.
 * `sessionYmds` lists every included session ascending, so the page can load exactly the wall
 * rails that have matching bars (a rail without bars would put beads on empty chart space).
 */
export async function fetchVectorSeedBars(
  ticker: string = VECTOR_DEFAULT_TICKER,
  now = new Date(),
  fetchIndex: typeof fetchIndexMinuteBars = fetchIndexMinuteBars,
  fetchStock: typeof fetchStockMinuteBars = fetchStockMinuteBars,
  fetchSpyVolume: (ymd: string) => Promise<Map<number, number>> = fetchSpyVolumeByMinute,
  targetSessions: number = TARGET_SEED_SESSIONS
): Promise<{
  bars: VectorSeedBar[];
  sessionYmd: string;
  ticker: string;
  /** Every session actually included in `bars`, ascending (oldest first). */
  sessionYmds: string[];
  /** Epoch-sec time of the LATEST session's first bar — the honest-reconstruction window start. */
  latestSessionStartSec: number | null;
}> {
  const t = normalizeVectorTicker(ticker);
  const today = formatEtDate(now);
  const target = Math.max(1, Math.floor(targetSessions));
  const polySym = vectorPolygonMinuteSymbol(t);
  const useIndex = isVectorIndexTicker(t);

  // Candidate trading days, newest first. previousTradingDayEt already skips weekends/holidays,
  // so nearly every candidate is a real session — the walk-back padding only absorbs provider
  // data gaps. Precomputing the list lets the per-day fetches run in PARALLEL: the old
  // sequential walk was fine at 3 sessions but 15+ sequential Polygon round-trips would add
  // seconds to SSR.
  const candidates: string[] = [];
  {
    let ymd = today;
    for (let i = 0; i < MAX_SESSION_WALKBACK; i++) {
      candidates.push(ymd);
      ymd = previousTradingDayEt(ymd);
    }
  }

  const fetchSession = async (ymd: string): Promise<{ ymd: string; bars: VectorSeedBar[] }> => {
    const rawBars = useIndex
      ? await fetchIndex(polySym, ymd, ymd).catch(() => [])
      : await fetchStock(t, ymd, ymd).catch(() => []);
    if (!rawBars.length) return { ymd, bars: [] };
    // SPX has no native tape volume — fetch SPY 1m volume per included session so prior-day
    // SPX bars carry volume too (the live backfill in VectorChart only refreshes sessionYmd).
    let volumeByTime: Map<number, number> | undefined;
    if (t === "SPX") volumeByTime = await fetchSpyVolume(ymd).catch(() => new Map());
    return { ymd, bars: mapMinuteBars(rawBars, volumeByTime) };
  };

  // Collected newest-first; emitted oldest-first below. Fetch in target-sized parallel batches:
  // batch 1 almost always fills the target (candidates are real trading days), batch 2+ only
  // runs when data-gap days left the target short.
  const sessions: Array<{ ymd: string; bars: VectorSeedBar[] }> = [];
  let cursor = 0;
  while (sessions.length < target && cursor < candidates.length) {
    const batch = candidates.slice(cursor, cursor + Math.max(1, target - sessions.length));
    cursor += batch.length;
    const results = await Promise.all(batch.map(fetchSession));
    for (const r of results) if (r.bars.length > 0) sessions.push(r);
  }

  if (!sessions.length) {
    return { bars: [], sessionYmd: today, ticker: t, sessionYmds: [], latestSessionStartSec: null };
  }

  // First non-empty session (newest candidate order) is the latest one — today, or the most
  // recent trading day when today has no bars yet. That's what sessionYmd must stay.
  const latestYmd = sessions[0]!.ymd;

  // Decimate sessions older than the newest FULL_RES_SESSIONS to 5m and apply the bar-count
  // ceiling newest-first, dropping whole oldest sessions past the cap (never a partial one).
  const included: Array<{ ymd: string; bars: VectorSeedBar[] }> = [];
  let totalBars = 0;
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]!;
    const sessionBars =
      i < FULL_RES_SESSIONS
        ? s.bars
        : (aggregateVectorBars(s.bars, PRIOR_SESSION_BAR_MINUTES) as VectorSeedBar[]);
    if (included.length > 0 && totalBars + sessionBars.length > MAX_SEED_BARS) break;
    included.push({ ymd: s.ymd, bars: sessionBars });
    totalBars += sessionBars.length;
  }

  // Emit oldest-first so the chart draws left→right, and enforce strictly ascending unique
  // time across the session boundaries (defensive: drop any bar that isn't newer than the
  // last kept one, so a provider quirk can't produce a duplicate or backwards step).
  const bars: VectorSeedBar[] = [];
  let lastTime = Number.NEGATIVE_INFINITY;
  for (let s = included.length - 1; s >= 0; s--) {
    for (const bar of included[s]!.bars) {
      if (bar.time <= lastTime) continue;
      bars.push(bar);
      lastTime = bar.time;
    }
  }

  return {
    bars,
    sessionYmd: latestYmd,
    ticker: t,
    sessionYmds: included.map((s) => s.ymd).reverse(),
    latestSessionStartSec: included[0]?.bars[0]?.time ?? null,
  };
}
