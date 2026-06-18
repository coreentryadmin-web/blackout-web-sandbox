import { fetchTickerFlowDailyNet } from "@/lib/db";

export type FlowStreak = {
  streak_days: number;
  net_3d: number;
  net_5d: number;
  direction: "long" | "short" | "mixed";
};

export async function fetchTickerFlowStreak(ticker: string): Promise<FlowStreak> {
  const buckets = await fetchTickerFlowDailyNet(ticker, 10);
  if (!buckets.length) {
    return { streak_days: 0, net_3d: 0, net_5d: 0, direction: "mixed" };
  }

  const net3 = buckets.slice(0, 3).reduce((s, b) => s + b.net, 0);
  const net5 = buckets.slice(0, 5).reduce((s, b) => s + b.net, 0);

  let streak = 0;
  const firstDir = buckets[0]!.net >= 0 ? "long" : "short";
  for (const b of buckets) {
    const dir = b.net >= 0 ? "long" : "short";
    if (dir === firstDir && Math.abs(b.net) > 0) streak++;
    else break;
  }

  return {
    streak_days: streak,
    net_3d: net3,
    net_5d: net5,
    direction: firstDir,
  };
}
