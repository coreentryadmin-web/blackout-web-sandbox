import { fetchSectorPerformance, fetchIndexDailyBars, fetchIndex5MinBars, fetchIndexSnapshots, fetchVixIvRankPercentile, computeVixTermStructure, fetchDailyMarketSummary, fetchPriorDayCloses, computeMarketBreadthFromSummary, type MarketBreadthMetrics } from "@/lib/providers/polygon";
import { fetchPolygonMarketNews } from "@/lib/providers/polygon-largo";
import { macroEventsOnDateLive } from "@/lib/providers/macro-events";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import {
  fetchMarketFlowAlertRows,
  fetchUwEarningsAfterhours,
  fetchUwEarningsPremarket,
  fetchUwEtfTide,
  fetchUwGroupGreekFlow,
  fetchUwMacroIndicators,
  fetchUwMarketTide,
  fetchUwMarketTopNetImpact,
  fetchUwPredictionsConsensus,
  fetchUwSectorTide,
  fetchUwTickerFlowAlerts,
  type PredictionConsensusSignal,
} from "@/lib/providers/unusual-whales";
import { summarizeGroupGreekFlow, type GroupGreekFlowSummary } from "@/lib/group-greek-flow-summary";
import type { UwMacroIndicatorSnapshot } from "@/lib/providers/unusual-whales";
import {
  INDEX_SET,
  INDEX_TICKERS,
  MIN_HOT_CHAIN_PREMIUM,
  MIN_STOCK_FLOW_PREMIUM,
  MARKET_FLOW_ALERT_LIMIT,
  SECTOR_WATCH,
} from "./constants";
import { computeSpxGapContext, type SpxGapContext } from "./spx-gap";
import { nextTradingDayEt, todayEt } from "./session";
import { priorEtYmd } from "@/lib/providers/spx-session";
import { runUwPool, runUwSequential } from "@/lib/providers/uw-rate-limiter";

export type MarketWideContext = {
  today: string;
  tomorrow: string;
  tide: Record<string, unknown> | null;
  stock_flows: Record<string, unknown>[];
  hot_chains: Record<string, unknown>[];
  index_flows: Record<string, unknown>;
  spx_bars: Array<{ o: number; h: number; l: number; c: number; t?: number }>;
  spx_intraday_5m: Array<{ o: number; h: number; l: number; c: number; t?: number }>;
  spx_gap: SpxGapContext | null;
  vix_bars: Array<{ o: number; h: number; l: number; c: number; t?: number }>;
  market_news: Record<string, unknown>[];
  macro_events: Record<string, unknown>[];
  tomorrow_earnings: Record<string, unknown>[];
  sector_tides: Array<{ sector: string; tide: Record<string, unknown> | null }>;
  etf_tides: Record<string, Record<string, unknown> | null>;
  sector_performance: Array<{ name: string; change_pct: number }>;
  top_net_impact: Record<string, unknown>[];
  vix_term: Record<string, unknown>[];
  vix_iv_rank: number | null;
  market_breadth: MarketBreadthMetrics | null;
  predictions_consensus: PredictionConsensusSignal[];
  mag7_greek_flow: GroupGreekFlowSummary | null;
  macro_indicators: UwMacroIndicatorSnapshot[];
};

function flowRowToDict(row: { raw: Record<string, unknown>; flow: { ticker: string; premium: number } }) {
  return {
    ...row.raw,
    ticker: row.flow.ticker,
    total_premium: row.flow.premium,
  };
}

function aggregateHotChains(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byTicker = new Map<string, { ticker: string; total_premium: number; volume: number }>();
  for (const r of rows) {
    const ticker = String(r.ticker ?? "").toUpperCase();
    if (!ticker || INDEX_SET.has(ticker)) continue;
    const prem = Number(r.total_premium ?? r.premium ?? 0);
    const vol = Number(r.volume ?? r.total_volume ?? 0);
    const cur = byTicker.get(ticker) ?? { ticker, total_premium: 0, volume: 0 };
    cur.total_premium += prem;
    cur.volume += vol;
    byTicker.set(ticker, cur);
  }
  return Array.from(byTicker.values()).sort((a, b) => b.total_premium - a.total_premium);
}

function mapBars(
  results: Array<{ o?: number; h?: number; l?: number; c?: number; t?: number }> | undefined
) {
  return (results ?? []).map((b) => ({
    o: Number(b.o ?? 0),
    h: Number(b.h ?? 0),
    l: Number(b.l ?? 0),
    c: Number(b.c ?? 0),
    t: b.t,
  }));
}

/** VIX term from Polygon index snapshots — UW fallback only if Polygon unavailable. */
async function fetchVixTermPreferPolygon(): Promise<Record<string, unknown>[]> {
  if (polygonConfigured()) {
    const snaps = await fetchIndexSnapshots(["I:VIX", "I:VIX9D", "I:VIX3M"]).catch(() => ({} as Awaited<ReturnType<typeof fetchIndexSnapshots>>));
    const spot = snaps["I:VIX"]?.price ?? null;
    const near = snaps["I:VIX9D"]?.price ?? null;
    const far = snaps["I:VIX3M"]?.price ?? null;
    const term = computeVixTermStructure(spot, near, far);
    if (term.structure !== "unknown") {
      return [
        {
          source: "polygon",
          structure: term.structure,
          detail: term.detail,
          vix9d: term.vix9d,
          vix3m: term.vix3m,
        },
      ];
    }
  }
  return [];
}

async function fetchMarketNewsPreferPolygon(): Promise<Record<string, unknown>[]> {
  // Benzinga (via Polygon) is paid — no UW fallback needed; UW quota reserved for flow/tide/dark pool.
  const poly = await fetchPolygonMarketNews(16).catch(() => []);
  return poly.map((n) => ({
    title: n.title,
    source: "polygon",
    published_at: n.published,
  }));
}

async function fetchEarningsOnDate(dateYmd: string): Promise<Record<string, unknown>[]> {
  if (!uwConfigured()) return [];
  const [pre, aft] = await runUwSequential([
    () => fetchUwEarningsPremarket(50).catch(() => []),
    () => fetchUwEarningsAfterhours(50).catch(() => []),
  ]);
  return [...pre, ...aft].filter((row) => {
    const d = String(row.report_date ?? row.date ?? row.earnings_date ?? row.announce_date ?? "").slice(0, 10);
    return d === dateYmd;
  });
}

async function fetchSectorTidesSequential(): Promise<Array<{ sector: string; tide: Record<string, unknown> | null }>> {
  if (!uwConfigured()) {
    return SECTOR_WATCH.map((s) => ({ sector: s.label, tide: null }));
  }
  return runUwSequential(
    SECTOR_WATCH.map((s) => async () => ({
      sector: s.label,
      tide: (await fetchUwSectorTide(s.key).catch(() => null)) as Record<string, unknown> | null,
    }))
  );
}

async function fetchEtfTidesSequential(): Promise<Record<string, Record<string, unknown> | null>> {
  const tickers = ["SPY", "QQQ", "IWM", "XLF", "XLE"] as const;
  if (!uwConfigured()) {
    return Object.fromEntries(tickers.map((t) => [t, null]));
  }
  const rows = await runUwSequential(
    tickers.map((t) => () => fetchUwEtfTide(t).catch(() => null))
  );
  return {
    SPY: rows[0] as Record<string, unknown> | null,
    QQQ: rows[1] as Record<string, unknown> | null,
    IWM: rows[2] as Record<string, unknown> | null,
    XLF: rows[3] as Record<string, unknown> | null,
    XLE: rows[4] as Record<string, unknown> | null,
  };
}

async function fetchIndexFlowsPooled(): Promise<Record<string, unknown>> {
  if (!uwConfigured()) return {};
  const indexResults = await runUwPool(
    INDEX_TICKERS.map((t) => async () => {
      const alerts = await fetchUwTickerFlowAlerts(t, 30).catch(() => []);
      const callPrem = alerts
        .filter((a) => a.option_type === "CALL")
        .reduce((s, a) => s + a.premium, 0);
      const putPrem = alerts
        .filter((a) => a.option_type === "PUT")
        .reduce((s, a) => s + a.premium, 0);
      return {
        ticker: t,
        call_premium: callPrem,
        put_premium: putPrem,
        total_premium: callPrem + putPrem,
        alerts: alerts.length,
      };
    }),
    3
  );
  const indexFlows: Record<string, unknown> = {};
  for (const row of indexResults) indexFlows[row.ticker] = row;
  return indexFlows;
}

export async function fetchMarketWideContext(): Promise<MarketWideContext> {
  const today = todayEt();
  const tomorrow = nextTradingDayEt(today);
  const from = priorEtYmd(45);

  const [
    tide,
    flowRows,
    spxRaw,
    spxIntradayRaw,
    vixRaw,
    sectorPerf,
    sectorTides,
    etfTides,
    marketNews,
    vixTerm,
    vixIvRank,
    topNetImpact,
    dailyMarket,
    predictionsRaw,
    mag7Rows,
    macroIndicators,
  ] = await Promise.all([
    uwConfigured() ? fetchUwMarketTide().catch(() => null) : Promise.resolve(null),
    uwConfigured()
      ? fetchMarketFlowAlertRows({ limit: MARKET_FLOW_ALERT_LIMIT, min_premium: MIN_STOCK_FLOW_PREMIUM }).catch(() => [])
      : Promise.resolve([]),
    fetchIndexDailyBars("I:SPX", from, today, "30").catch(() => []),
    polygonConfigured() ? fetchIndex5MinBars("I:SPX", today, today).catch(() => []) : Promise.resolve([]),
    fetchIndexDailyBars("I:VIX", from, today, "30").catch(() => []),
    fetchSectorPerformance().catch(() => []),
    fetchSectorTidesSequential(),
    fetchEtfTidesSequential(),
    fetchMarketNewsPreferPolygon(),
    fetchVixTermPreferPolygon(),
    fetchVixIvRankPercentile().catch(() => null),
    uwConfigured() ? fetchUwMarketTopNetImpact(12).catch(() => []) : Promise.resolve([]),
    fetchDailyMarketSummary(today).catch(() => null),
    uwConfigured() ? fetchUwPredictionsConsensus(15).catch(() => null) : Promise.resolve(null),
    uwConfigured() ? fetchUwGroupGreekFlow("mag7").catch(() => []) : Promise.resolve([]),
    uwConfigured() ? fetchUwMacroIndicators().catch(() => []) : Promise.resolve([]),
  ]);

  const stockFlows = flowRows
    .map(flowRowToDict)
    .filter((r) => {
      const ticker = String(r.ticker ?? "").toUpperCase();
      return ticker && !INDEX_SET.has(ticker);
    });

  const hotChainRows = flowRows
    .filter((r) => r.flow.premium >= MIN_HOT_CHAIN_PREMIUM)
    .map(flowRowToDict);
  const hotChains = aggregateHotChains(hotChainRows);

  // RECAP-MUST-NOT-THROW (#77 hardening C): every throw-prone tail call here must degrade to an
  // empty default, never throw. If any of these throws BEFORE the function returns, the builder's
  // outer catch fires and we get a failed/no-row edition (the #77 dark-fail relocated one stage
  // earlier). With these guards fetchMarketWideContext can only return a (possibly thin) ctx.
  const indexFlows = await fetchIndexFlowsPooled().catch(() => ({} as Record<string, unknown>));

  const macroEvents = (await macroEventsOnDateLive(tomorrow).catch(() => []))
    .filter((e) => e.impact === "high")
    .map((e) => ({ ...e }) as Record<string, unknown>);

  const tomorrowEarnings = await fetchEarningsOnDate(tomorrow).catch(() => []);

  const priorCloses = dailyMarket?.results?.length
    ? await fetchPriorDayCloses(today).catch(() => ({}))
    : {};
  // computeMarketBreadthFromSummary is synchronous — a .catch() can't guard it, so wrap in try/catch.
  let marketBreadth: MarketBreadthMetrics | null = null;
  if (dailyMarket?.results?.length) {
    try {
      marketBreadth = computeMarketBreadthFromSummary(dailyMarket.results, priorCloses);
    } catch {
      marketBreadth = null;
    }
  }

  const spxBars = mapBars(spxRaw as Array<{ o?: number; h?: number; l?: number; c?: number; t?: number }>);
  const spxIntraday5m = mapBars(
    spxIntradayRaw as Array<{ o?: number; h?: number; l?: number; c?: number; t?: number }>
  );
  // computeSpxGapContext is synchronous — guard it the same way so a gap-calc throw can't kill the recap.
  let spxGap: SpxGapContext | null = null;
  try {
    spxGap = computeSpxGapContext(spxBars, spxIntraday5m);
  } catch {
    spxGap = null;
  }

  return {
    today,
    tomorrow,
    tide: tide as Record<string, unknown> | null,
    stock_flows: stockFlows,
    hot_chains: hotChains,
    index_flows: indexFlows,
    spx_bars: spxBars,
    spx_intraday_5m: spxIntraday5m,
    spx_gap: spxGap,
    vix_bars: mapBars(vixRaw as Array<{ o?: number; h?: number; l?: number; c?: number; t?: number }>),
    market_news: marketNews,
    macro_events: macroEvents,
    tomorrow_earnings: tomorrowEarnings,
    sector_tides: sectorTides,
    etf_tides: etfTides,
    sector_performance: sectorPerf,
    top_net_impact: topNetImpact,
    vix_term: vixTerm,
    vix_iv_rank: vixIvRank,
    market_breadth: marketBreadth,
    predictions_consensus: predictionsRaw?.top_signals ?? [],
    mag7_greek_flow: summarizeGroupGreekFlow("mag7", mag7Rows as Record<string, unknown>[]),
    macro_indicators: macroIndicators,
  };
}
