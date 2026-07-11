import { todayEtYmd } from "@/lib/providers/spx-session";
import { fetchStockMinuteBars } from "@/lib/providers/polygon";

type AggBar = { t?: number; o: number; h: number; l: number; c: number; v?: number };
type FetchSpyBars = (symbol: string, from: string, to: string) => Promise<AggBar[]>;

const SPY_RETRY_MS = 350;

/** Minute epoch seconds → SPY share volume for that session day. */
export async function fetchSpyVolumeByMinute(
  ymd: string,
  fetchSpy: FetchSpyBars = fetchStockMinuteBars,
  attempts = 2
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (let i = 0; i < attempts; i++) {
    try {
      const bars = await fetchSpy("SPY", ymd, ymd);
      for (const b of bars) {
        if (typeof b.t !== "number" || b.v == null || b.v <= 0) continue;
        map.set(Math.floor(b.t / 1000), b.v);
      }
      if (map.size > 0) return map;
    } catch {
      /* retry below */
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, SPY_RETRY_MS));
    }
  }
  return map;
}

/** JSON-friendly volume rows for client backfill when SSR seed missed SPY. */
export async function fetchSpyVolumeRows(ymd: string): Promise<Array<{ time: number; volume: number }>> {
  const map = await fetchSpyVolumeByMinute(ymd);
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, volume]) => ({ time, volume }));
}

type VolumeCache = { barTimeSec: number; volume: number; fetchedAt: number };
type DayBarsCache = { ymd: string; fetchedAt: number; volumeByBarSec: Map<number, number> };

let cache: VolumeCache | null = null;
let dayBars: DayBarsCache | null = null;
const CACHE_MS = 55_000;
/**
 * Negative-result window. The caller asks for the CURRENTLY FORMING minute
 * every ~1s tick, and Polygon only publishes a SPY row once that minute
 * CLOSES — so the steady state is a miss. Without this cache each miss
 * refetched the entire day of SPY minute bars (~60 real Polygon calls/min per
 * replica, all session, draining the shared rate budget for a lookup that
 * almost never hits). One fetch per 10s bounds the cost while still picking
 * up each newly-closed bar within seconds.
 */
const DAY_BARS_CACHE_MS = 10_000;

/**
 * SPY 1m share volume for the minute bar aligned with SPX — standard proxy when the
 * index chart has no native tape volume. Returns undefined when Polygon has no bar yet.
 */
export async function spyVolumeForMinuteBar(
  barTimeSec: number,
  nowMs: number = Date.now(),
  fetchSpy: FetchSpyBars = fetchStockMinuteBars
): Promise<number | undefined> {
  if (!Number.isFinite(barTimeSec) || barTimeSec <= 0) return undefined;
  if (
    cache &&
    cache.barTimeSec === barTimeSec &&
    nowMs - cache.fetchedAt < CACHE_MS
  ) {
    return cache.volume;
  }

  const ymd = todayEtYmd();
  if (!dayBars || dayBars.ymd !== ymd || nowMs - dayBars.fetchedAt >= DAY_BARS_CACHE_MS) {
    const bars = await fetchSpy("SPY", ymd, ymd).catch(() => []);
    const volumeByBarSec = new Map<number, number>();
    for (const b of bars) {
      if (typeof b.t !== "number" || b.v == null || !Number.isFinite(b.v) || b.v <= 0) continue;
      volumeByBarSec.set(Math.floor(b.t / 1000), b.v);
    }
    // Cache even when empty/failed — the negative result is exactly what
    // needs rate-limiting; the next real attempt comes in DAY_BARS_CACHE_MS.
    dayBars = { ymd, fetchedAt: nowMs, volumeByBarSec };
  }

  const volume = dayBars.volumeByBarSec.get(barTimeSec);
  if (volume == null || !Number.isFinite(volume) || volume <= 0) return undefined;

  // Long-cache only CLOSED bars: a row Polygon publishes for the still-forming
  // minute carries partial volume, and freezing it for 55s would stamp that
  // partial figure as the bar's volume (stale-as-current). The 10s day-bars
  // window already serves the forming bar cheaply.
  const barClosed = nowMs >= (barTimeSec + 60) * 1000;
  if (barClosed) {
    cache = { barTimeSec, volume, fetchedAt: nowMs };
  }
  return volume;
}

/** Test-only reset. */
export function _resetSpyVolumeCacheForTest(): void {
  cache = null;
  dayBars = null;
}
