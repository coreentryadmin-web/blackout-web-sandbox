import { dbConfigured, getMeta, setMeta } from "@/lib/db";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { flowAlignedForDirection } from "@/lib/spx-play-confirmations";
import {
  playMtfBufferPts,
  playOpeningRangeMinutes,
  playWatchEntryMaxPriceDriftPts,
  playWatchExtendAgeMin,
  playWatchMaxAgeMin,
  playWatchOpeningRangeDriftPts,
} from "@/lib/spx-play-config";
import { etClock, etMinutes } from "@/lib/spx-play-session-time";

export type WatchRecord = {
  setup_key: string;
  direction: SpxPlayDirection;
  first_at: string;
  level: number;
  price: number;
  grade: string;
  score: number;
  headline: string;
  hybrid_ok: boolean;
  consumed: boolean;
};

const WATCH_KEY = "spx_watch_record";
const memoryWatch: { record: WatchRecord | null } = { record: null };

function effectiveWatchMaxAgeMin(desk: SpxDeskPayload, direction: SpxPlayDirection): number {
  const flowOk = flowAlignedForDirection(desk, direction);
  const tickOk =
    desk.tick == null ||
    (direction === "long" ? desk.tick > -100 : desk.tick < 100);
  if (flowOk && tickOk) return playWatchExtendAgeMin();
  return playWatchMaxAgeMin();
}
// W-1: Accept optional `now` param to use the evaluation instant rather than a new Date() internally.
function watchMaxDriftPts(rec: WatchRecord, now = new Date()): number {
  const openingRangeEnd = etClock(9, 30) + playOpeningRangeMinutes();
  const watchEtMins = etMinutes(new Date(rec.first_at));
  const watchFormedInOpeningRange =
    watchEtMins >= etClock(9, 30) && watchEtMins < openingRangeEnd;
  const afterOpeningRange = etMinutes(now) >= openingRangeEnd;

  if (watchFormedInOpeningRange && afterOpeningRange) {
    return playWatchOpeningRangeDriftPts();
  }
  return playWatchEntryMaxPriceDriftPts();
}

// W-3: Include session date so a stale yesterday WATCH record never matches today's key.
export function watchSetupKey(direction: SpxPlayDirection): string {
  return `0dte:${direction}:${todayEtYmd()}`;
}

export async function loadWatchRecord(): Promise<WatchRecord | null> {
  if (memoryWatch.record && !memoryWatch.record.consumed) {
    return memoryWatch.record;
  }
  if (!dbConfigured()) return memoryWatch.record?.consumed ? null : memoryWatch.record;

  const raw = await getMeta(WATCH_KEY);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as WatchRecord;
    if (rec.consumed) return null;
    memoryWatch.record = rec;
    return rec;
  } catch {
    return null;
  }
}

export async function recordWatch(rec: Omit<WatchRecord, "consumed" | "first_at"> & { first_at?: string }): Promise<void> {
  const existing = await loadWatchRecord();
  const row: WatchRecord = {
    ...rec,
    first_at: existing?.setup_key === rec.setup_key ? existing.first_at : rec.first_at ?? new Date().toISOString(),
    consumed: false,
  };
  memoryWatch.record = row;
  if (!dbConfigured()) return;
  await setMeta(WATCH_KEY, JSON.stringify(row));
}

export async function consumeWatchRecord(): Promise<void> {
  if (!dbConfigured()) {
    const rec = memoryWatch.record;
    if (rec && !rec.consumed) {
      memoryWatch.record = { ...rec, consumed: true };
    }
    return;
  }

  const rec = await loadWatchRecord();
  if (rec) {
    await setMeta(WATCH_KEY, JSON.stringify({ ...rec, consumed: true }));
  }
  memoryWatch.record = null;
}

export async function clearWatchRecord(): Promise<void> {
  memoryWatch.record = null;
  if (!dbConfigured()) return;
  await setMeta(WATCH_KEY, "");
}

export type WatchPromoteResult = {
  eligible: boolean;
  reason: string;
  record: WatchRecord | null;
};

export async function evaluateWatchPromote(params: {
  direction: SpxPlayDirection;
  price: number;
  level: number;
  hybridHardOk: boolean;
  score: number;
  fullMinScore: number;
  desk: SpxDeskPayload;
  flowOk: boolean;
}): Promise<WatchPromoteResult> {
  const rec = await loadWatchRecord();
  if (!rec) {
    return { eligible: false, reason: "No prior WATCH on file", record: null };
  }

  if (rec.direction !== params.direction) {
    await clearWatchRecord();
    return { eligible: false, reason: "WATCH cleared — direction flipped", record: null };
  }

  if (params.score < params.fullMinScore) {
    return { eligible: false, reason: `Score ${params.score} below entry threshold`, record: rec };
  }

  if (!params.hybridHardOk) {
    return { eligible: false, reason: "MTF hard confirm required for promote", record: rec };
  }

  if (!params.flowOk) {
    return { eligible: false, reason: "WATCH→ENTRY requires 0DTE flow alignment", record: rec };
  }

  const ageMin = (Date.now() - new Date(rec.first_at).getTime()) / 60_000;
  const maxAge = effectiveWatchMaxAgeMin(params.desk, params.direction);
  if (ageMin > maxAge) {
    await clearWatchRecord();
    return { eligible: false, reason: `WATCH expired (${maxAge}m)`, record: null };
  }

  const drift = Math.abs(params.price - rec.price);
  const maxDrift = watchMaxDriftPts(rec, new Date());
  if (drift > maxDrift) {
    return { eligible: false, reason: `Price drift ${drift.toFixed(1)} pts (max ${maxDrift})`, record: rec };
  }

  const buf = playMtfBufferPts();
  if (params.direction === "long" && params.price < params.level - buf) {
    return { eligible: false, reason: "Lost watch level (long)", record: rec };
  }
  if (params.direction === "short" && params.price > params.level + buf) {
    return { eligible: false, reason: "Lost watch level (short)", record: rec };
  }

  if (!rec.hybrid_ok) {
    return { eligible: false, reason: "Prior WATCH lacked MTF confirm", record: rec };
  }

  return { eligible: true, reason: "WATCH→ENTRY promote", record: rec };
}
