/**
 * Seed Redis uw_cache:* from in-process UW WebSocket stores when channels are fresh.
 * Keeps the 2-RPS REST budget for paths the multiplex socket already delivers.
 */
import type { DarkPoolSnapshot } from "@/lib/providers/unusual-whales";
import type { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import {
  aggregateFlowPerStrikeRows,
  aggregateOptionTradesToStrikeRows,
  type NetPremTick,
} from "@/lib/providers/unusual-whales";
import { UW_CACHE_TTL, UW_KEYS, uwCacheRead, uwCacheSet } from "@/lib/providers/uw-shared-cache";
import {
  darkPoolStore,
  getNetPremTicksForTicker,
  isUwChannelFresh,
  optionTradesStore,
  tideStore,
} from "@/lib/ws/uw-socket";

export type UwWsCacheSeedResult = {
  seeded: number;
  skipped_ws: string[];
};

export async function seedUwCacheFromWsStores(
  redis: Awaited<ReturnType<typeof getUwCacheRedis>>
): Promise<UwWsCacheSeedResult> {
  const skipped_ws: string[] = [];
  let seeded = 0;

  if (isUwChannelFresh("market_tide", 180_000) && tideStore.updatedAt > 0) {
    await uwCacheSet(redis, UW_KEYS.marketTide(), UW_CACHE_TTL.marketTide, {
      call_premium: tideStore.call_premium,
      put_premium: tideStore.put_premium,
      net: tideStore.net,
      bias: tideStore.bias,
    });
    seeded += 1;
    skipped_ws.push("market_tide");
  }

  if (isUwChannelFresh("off_lit_trades", 120_000) && darkPoolStore.updatedAt > 0 && darkPoolStore.data) {
    await uwCacheSet(redis, UW_KEYS.darkPoolRecent(), UW_CACHE_TTL.darkPoolRecent, darkPoolStore.data);
    await uwCacheSet(redis, UW_KEYS.darkPoolTicker("SPX"), UW_CACHE_TTL.darkPoolTicker, darkPoolStore.data);
    seeded += 1;
    skipped_ws.push("off_lit_trades");
  }

  if (isUwChannelFresh("net_flow", 120_000)) {
    for (const ticker of ["SPX", "SPY", "QQQ", "IWM"] as const) {
      const ticks: NetPremTick[] = getNetPremTicksForTicker(ticker);
      if (!ticks.length) continue;
      await uwCacheSet(redis, UW_KEYS.netPremTicks(ticker), UW_CACHE_TTL.netPremTicks, ticks);
      seeded += 1;
    }
    skipped_ws.push("net_flow");
  }

  if (isUwChannelFresh("option_trades", 120_000) && optionTradesStore.rows.length > 0) {
    for (const ticker of ["SPX", "SPY"] as const) {
      const rows = aggregateOptionTradesToStrikeRows(optionTradesStore.rows, ticker);
      if (!rows.length) continue;
      await uwCacheSet(redis, UW_KEYS.flowPerStrike(ticker), UW_CACHE_TTL.flowPerStrike, aggregateFlowPerStrikeRows(rows));
      seeded += 1;
    }
    skipped_ws.push("option_trades");
  }

  return { seeded, skipped_ws };
}

/** Cross-replica read: Redis snapshot seeded by the UW WS leader (no REST). */
export async function readUwDeskLaneFromRedis<T>(key: string): Promise<T | null> {
  return uwCacheRead<T>(key);
}

export async function readUwMarketTideFromRedis(): Promise<{
  call_premium: number;
  put_premium: number;
  net: number;
  bias: string;
} | null> {
  return readUwDeskLaneFromRedis(UW_KEYS.marketTide());
}

export async function readUwDarkPoolFromRedis(ticker = "SPX"): Promise<DarkPoolSnapshot | null> {
  const tickerSnap = await readUwDeskLaneFromRedis<DarkPoolSnapshot>(UW_KEYS.darkPoolTicker(ticker));
  if (tickerSnap?.prints?.length) return tickerSnap;
  return readUwDeskLaneFromRedis<DarkPoolSnapshot>(UW_KEYS.darkPoolRecent());
}

export function shouldSkipUwCacheRefreshTask(
  task: "market_tide" | "net_prem_ticks" | "flow_per_strike",
  ticker?: string
): boolean {
  if (task === "market_tide") {
    return isUwChannelFresh("market_tide", 180_000) && tideStore.updatedAt > 0;
  }
  if (task === "net_prem_ticks" && ticker) {
    return isUwChannelFresh("net_flow", 120_000) && getNetPremTicksForTicker(ticker).length > 0;
  }
  if (task === "flow_per_strike" && ticker) {
    return (
      isUwChannelFresh("option_trades", 120_000) &&
      aggregateOptionTradesToStrikeRows(optionTradesStore.rows, ticker).length > 0
    );
  }
  return false;
}
