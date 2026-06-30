// Cron: pre-warm Unusual Whales Redis cache for top tickers and market-wide signals.
// Schedule: every 2 minutes (registered in cron-registry.ts as "uw-cache-refresh").
// When UW WS channels are fresh, seeds Redis from in-process stores first and skips
// the matching REST warm tasks (see uw-ws-cache-bridge.ts).

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
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
  UW_FLOW_PER_STRIKE_FETCH_CAP,
  aggregateFlowPerStrikeRows,
} from "@/lib/providers/unusual-whales";
import { fetchMarketMovers } from "@/lib/providers/polygon";
import { seedUwCacheFromWsStores, shouldSkipUwCacheRefreshTask } from "@/lib/uw-ws-cache-bridge";

const INDEX_TICKERS = ["SPX", "SPY", "QQQ", "IWM"] as const;
const FLOW_STRIKE_TICKERS = ["SPX", "SPY"] as const;
const SECTORS = [
  "technology",
  "financial services",
  "energy",
  "healthcare",
  "consumer cyclical",
] as const;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = await getUwCacheRedis();
  let refreshed = 0;
  let ws_seeded = 0;
  let ws_skipped: string[] = [];

  const seed = await seedUwCacheFromWsStores(redis);
  ws_seeded = seed.seeded;
  ws_skipped = seed.skipped_ws;

  const tasks: Array<() => Promise<void>> = [
    async () => {
      if (shouldSkipUwCacheRefreshTask("market_tide")) return;
      const data = await fetchUwMarketTide();
      await uwCacheSet(redis, UW_KEYS.marketTide(), UW_CACHE_TTL.marketTide, data);
    },

    ...SECTORS.map((sector) => async () => {
      const data = await fetchUwSectorTide(sector);
      await uwCacheSet(redis, UW_KEYS.sectorTide(sector), UW_CACHE_TTL.sectorTide, data);
    }),

    async () => {
      const data = await fetchUwDarkPoolRecent();
      await uwCacheSet(redis, UW_KEYS.darkPoolRecent(), UW_CACHE_TTL.darkPoolRecent, data);
    },

    async () => {
      const data = await fetchMarketMovers(20);
      await uwCacheSet(redis, UW_KEYS.marketMovers(), UW_CACHE_TTL.marketMovers, data);
    },

    async () => {
      const data = await fetchUwMarketTopNetImpact();
      await uwCacheSet(redis, UW_KEYS.topNetImpact(), UW_CACHE_TTL.topNetImpact, data);
    },

    async () => {
      const data = await fetchUwCongressTrades();
      await uwCacheSet(redis, UW_KEYS.congress(), UW_CACHE_TTL.congress, data);
    },

    ...INDEX_TICKERS.flatMap((ticker) => [
      async () => {
        if (shouldSkipUwCacheRefreshTask("net_prem_ticks", ticker)) return;
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

    ...FLOW_STRIKE_TICKERS.map((ticker) => async () => {
      if (shouldSkipUwCacheRefreshTask("flow_per_strike", ticker)) return;
      const rows = await fetchUwFlowPerStrikeRows(ticker, UW_FLOW_PER_STRIKE_FETCH_CAP);
      await uwCacheSet(
        redis,
        UW_KEYS.flowPerStrike(ticker),
        UW_CACHE_TTL.flowPerStrike,
        aggregateFlowPerStrikeRows(rows)
      );
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

  const allFailed = tasks.length > 0 && failed === tasks.length;
  await logCronRun("uw-cache-refresh", started, {
    ok: !allFailed,
    refreshed,
    failed,
    total: tasks.length,
    ws_seeded,
    ws_skipped,
    ...(failed > 0 ? { error: `${failed}/${tasks.length} refresh task(s) failed` } : {}),
  });

  return NextResponse.json({ ok: true, refreshed, total: tasks.length, ws_seeded, ws_skipped });
}
