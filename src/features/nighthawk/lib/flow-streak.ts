import { fetchTickerFlowDailyNet } from "@/lib/db";
import { formatEtDate, isTradingDayEt } from "./session";

export type FlowStreak = {
  streak_days: number;
  net_3d: number;
  net_5d: number;
  direction: "long" | "short" | "mixed";
};

/** The trading day immediately before `ymd` (skips weekends + NYSE holidays). */
function priorTradingDayYmd(ymd: string): string {
  let cursor = new Date(`${ymd}T12:00:00`);
  for (let i = 0; i < 12; i++) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    const prev = formatEtDate(cursor);
    if (isTradingDayEt(prev)) return prev;
  }
  return formatEtDate(cursor);
}

export function computeFlowStreakFromBuckets(
  buckets: Array<{ day: string; net: number; call: number; put: number }>
): FlowStreak {
  if (!buckets.length) {
    return { streak_days: 0, net_3d: 0, net_5d: 0, direction: "mixed" };
  }

  const net3 = buckets.slice(0, 3).reduce((s, b) => s + b.net, 0);
  const net5 = buckets.slice(0, 5).reduce((s, b) => s + b.net, 0);

  // CONSECUTIVE-trading-day streak (audit MEDIUM): the DB GROUP BY only emits rows
  // for days that HAD flow — gap days are absent, not zero — so the old entry-count
  // loop scored Mon/Wed/Fri same-direction rows as a 3-day "streak". A streak that
  // drives a ×1.7 candidate multiplier and up to +12 scorer points must mean what it
  // says: each successive bucket must be the immediately-prior TRADING day (weekends
  // and NYSE holidays don't break it; a missing session does).
  let streak = 0;
  const firstDir = buckets[0]!.net >= 0 ? "long" : "short";
  let expectedDay = String(buckets[0]!.day).slice(0, 10);
  for (const b of buckets) {
    const day = String(b.day).slice(0, 10);
    if (day !== expectedDay) break;
    const dir = b.net >= 0 ? "long" : "short";
    if (dir !== firstDir || Math.abs(b.net) === 0) break;
    streak++;
    expectedDay = priorTradingDayYmd(day);
  }

  return {
    streak_days: streak,
    net_3d: net3,
    net_5d: net5,
    direction: firstDir,
  };
}

export async function fetchTickerFlowStreak(ticker: string): Promise<FlowStreak> {
  const buckets = await fetchTickerFlowDailyNet(ticker, 10);
  return computeFlowStreakFromBuckets(buckets);
}

export async function fetchTickersFlowStreaks(
  tickers: string[]
): Promise<Record<string, FlowStreak>> {
  if (!tickers.length) return {};
  const { fetchTickersFlowDailyNets } = await import("@/lib/db");
  const nets = await fetchTickersFlowDailyNets(tickers, 10);
  const out: Record<string, FlowStreak> = {};
  for (const ticker of tickers) {
    const sym = ticker.toUpperCase();
    out[sym] = computeFlowStreakFromBuckets(nets[sym] ?? []);
  }
  return out;
}
