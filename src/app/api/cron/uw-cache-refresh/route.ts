// Cron: pre-warm Unusual Whales Redis cache for top tickers and market-wide signals.
// Schedule: every 2 minutes (registered in cron-registry.ts as "uw-cache-refresh").
// Keeps the most-requested data hot so API routes read from Redis rather than hitting UW directly,
// reducing live UW call rate well below the 120/min plan cap.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { getUwCacheRedis, uwCacheSet, UW_KEYS, UW_CACHE_TTL } from "@/lib/providers/uw-shared-cache";
import {
  fetchUwMarketTide,
  fetchUwSectorTide,
  fetchUwDarkPoolRecent,
  fetchUwMarketTopNetImpact,
  fetchUwCongressTrades,
  fetchUwNetPremTicks,
  fetchUwNope,
  fetchUwDarkPool,
  fetchUwFlowPerStrikeRows,
} from "@/lib/providers/unusual-whales";
import { fetchMarketMovers } from "@/lib/providers/polygon";

const INDEX_TICKERS = ["SPX", "SPY", "QQQ", "IWM"] as const;
const FLOW_STRIKE_TICKERS = ["SPX", "SPY"] as const;
const SECTORS = [
  "technology",
  "financials",
  "energy",
  "healthcare",
  "consumer_discretionary",
] as const;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = await getUwCacheRedis();
  let refreshed = 0;

  const tasks: Array<() => Promise<void>> = [
    // Market Tide
    async () => {
      const data = await fetchUwMarketTide();
      await uwCacheSet(redis, UW_KEYS.marketTide(), UW_CACHE_TTL.marketTide, data);
    },

    // Sector Tide — five sectors
    ...SECTORS.map((sector) => async () => {
      const data = await fetchUwSectorTide(sector);
      await uwCacheSet(redis, UW_KEYS.sectorTide(sector), UW_CACHE_TTL.sectorTide, data);
    }),

    // Dark Pool Recent (market-wide)
    async () => {
      const data = await fetchUwDarkPoolRecent();
      await uwCacheSet(redis, UW_KEYS.darkPoolRecent(), UW_CACHE_TTL.darkPoolRecent, data);
    },

    // Market Movers — price-ranked, use Polygon (direct equivalent; frees UW quota)
    async () => {
      const data = await fetchMarketMovers(20);
      await uwCacheSet(redis, UW_KEYS.marketMovers(), UW_CACHE_TTL.marketMovers, data);
    },

    // Top Net Impact
    async () => {
      const data = await fetchUwMarketTopNetImpact();
      await uwCacheSet(redis, UW_KEYS.topNetImpact(), UW_CACHE_TTL.topNetImpact, data);
    },

    // Congress Recent
    async () => {
      const data = await fetchUwCongressTrades();
      await uwCacheSet(redis, UW_KEYS.congress(), UW_CACHE_TTL.congress, data);
    },

    // Per-index-ticker: Net Prem Ticks, NOPE, Dark Pool
    ...INDEX_TICKERS.flatMap((ticker) => [
      async () => {
        const data = await fetchUwNetPremTicks(ticker);
        await uwCacheSet(redis, UW_KEYS.netPremTicks(ticker), UW_CACHE_TTL.netPremTicks, data);
      },
      async () => {
        const data = await fetchUwNope(ticker);
        await uwCacheSet(redis, UW_KEYS.nope(ticker), UW_CACHE_TTL.nope, data);
      },
      async () => {
        const data = await fetchUwDarkPool(ticker);
        await uwCacheSet(redis, UW_KEYS.darkPoolTicker(ticker), UW_CACHE_TTL.darkPoolTicker, data);
      },
    ]),

    // Flow Per Strike — SPX and SPY only (high-call-cost endpoint)
    ...FLOW_STRIKE_TICKERS.map((ticker) => async () => {
      const data = await fetchUwFlowPerStrikeRows(ticker);
      await uwCacheSet(redis, UW_KEYS.flowPerStrike(ticker), UW_CACHE_TTL.flowPerStrike, data);
    }),
  ];

  const results = await Promise.allSettled(tasks.map((fn) => fn()));

  for (const r of results) {
    if (r.status === "fulfilled") refreshed += 1;
  }

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[cron/uw-cache-refresh] ${failed} task(s) failed`);
  }

  return NextResponse.json({ ok: true, refreshed, total: tasks.length });
}
