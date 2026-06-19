import { fetchSectorPerformance, fetchIndexDailyBars, fetchIndexSnapshots, fetchVixIvRankPercentile, computeVixTermStructure, fetchDailyMarketSummary, computeMarketBreadthFromSummary, type MarketBreadthMetrics } from "@/lib/providers/polygon";
import { fetchPolygonMarketNews } from "@/lib/providers/polygon-largo";
import { fetchFinnhubEarningsOnDate, fetchFinnhubEconomicCalendarRange } from "@/lib/providers/finnhub";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import {
  fetchMarketFlowAlertRows,
  fetchUwEtfTide,
  fetchUwGroupGreekFlow,
  fetchUwMacroIndicators,
  fetchUwMarketNewsHeadlines,
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
  SECTOR_WATCH,
} from "./constants";
import { nextTradingDayEt, priorEt, todayEt } from "./session";

export type MarketWideContext = {
  today: string;
  tomorrow: string;
  tide: Record<string, unknown> | null;
  stock_flows: Record<string, unknown>[];
  hot_chains: Record<string, unknown>[];
  index_flows: Record<string, unknown>;
  spx_bars: Array<{ o: number; h: number; l: number; c: number; t?: number }>;
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
    const snaps = await fetchIndexSnapshots(["I:VIX", "I:VIX9D", "I:VIX3M"]).catch(() => ({}));
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
  const poly = await fetchPolygonMarketNews(16).catch(() => []);
  const headlines: Record<string, unknown>[] = poly.map((n) => ({
    title: n.title,
    source: "polygon",
    published_at: n.published_utc,
  }));
  if (headlines.length >= 8 || !uwConfigured()) return headlines;
  const uw = await fetchUwMarketNewsHeadlines(12).catch(() => []);
  return [
    ...headlines,
    ...uw.map((n) => ({ ...n, source: "unusual_whales" })),
  ];
}

export async function fetchMarketWideContext(): Promise<MarketWideContext> {
  const today = todayEt();
  const tomorrow = nextTradingDayEt(today);
  const from = priorEt();

  const [
    tide,
    flowRows,
    spxRaw,
    vixRaw,
    sectorPerf,
    macroRaw,
    sectorTides,
    etfSpy,
    etfQqq,
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
      ? fetchMarketFlowAlertRows({ limit: 200, min_premium: MIN_STOCK_FLOW_PREMIUM }).catch(() => [])
      : Promise.resolve([]),
    fetchIndexDailyBars("I:SPX", from, today, "30").catch(() => []),
    fetchIndexDailyBars("I:VIX", from, today, "30").catch(() => []),
    fetchSectorPerformance().catch(() => []),
    fetchFinnhubEconomicCalendarRange(tomorrow, tomorrow).catch(() => null),
    Promise.all(
      SECTOR_WATCH.map(async (s) => ({
        sector: s.label,
        tide: uwConfigured() ? await fetchUwSectorTide(s.key).catch(() => null) : null,
      }))
    ),
    uwConfigured() ? fetchUwEtfTide("SPY").catch(() => null) : Promise.resolve(null),
    uwConfigured() ? fetchUwEtfTide("QQQ").catch(() => null) : Promise.resolve(null),
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

  const indexFlows: Record<string, unknown> = {};
  if (uwConfigured()) {
    const indexResults = await Promise.all(
      INDEX_TICKERS.map(async (t) => {
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
      })
    );
    for (const row of indexResults) indexFlows[row.ticker] = row;
  }

  const macroEvents = (macroRaw?.economicCalendar ?? []).filter(
    (e) => String(e.country ?? "").toUpperCase() === "US" && String(e.impact ?? "").toLowerCase() === "high"
  );

  const tomorrowEarnings = await fetchFinnhubEarningsOnDate(tomorrow).catch(() => []);

  const marketBreadth = dailyMarket?.results?.length
    ? computeMarketBreadthFromSummary(dailyMarket.results)
    : null;

  return {
    today,
    tomorrow,
    tide: tide as Record<string, unknown> | null,
    stock_flows: stockFlows,
    hot_chains: hotChains,
    index_flows: indexFlows,
    spx_bars: mapBars(spxRaw as Array<{ o?: number; h?: number; l?: number; c?: number; t?: number }>),
    vix_bars: mapBars(vixRaw as Array<{ o?: number; h?: number; l?: number; c?: number; t?: number }>),
    market_news: marketNews,
    macro_events: macroEvents,
    tomorrow_earnings: tomorrowEarnings,
    sector_tides: sectorTides,
    etf_tides: { SPY: etfSpy as Record<string, unknown> | null, QQQ: etfQqq as Record<string, unknown> | null },
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
