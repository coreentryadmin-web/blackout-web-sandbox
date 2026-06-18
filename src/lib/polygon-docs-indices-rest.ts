import type { RestEndpointSection } from "@/lib/polygon-docs-rest-types";

export const INDICES_REST_SECTIONS: RestEndpointSection[] = [
  {
    id: "tickers",
    title: "Tickers",
    endpoints: [
      {
        name: "All Tickers",
        method: "GET",
        path: "/v3/reference/tickers",
        description:
          "Comprehensive list of ticker symbols across asset classes. Each entry includes symbol, name, market, currency, and active status. Filter by market=indices for index-only lists.",
        useCases: "Asset discovery, data integration, filtering, application development.",
        docPath: "/rest/indices/tickers/all-tickers",
      },
      {
        name: "Ticker Overview",
        method: "GET",
        path: "/v3/reference/tickers/{ticker}",
        description:
          "Details for a single active index ticker — exchange, identifiers, classification, key dates. Use All Tickers with active=false for delisted.",
        useCases: "Index research, data integration, app enhancement, due diligence.",
        docPath: "/rest/indices/tickers/ticker-overview",
      },
    ],
  },
  {
    id: "aggregates",
    title: "Aggregate Bars (OHLC)",
    endpoints: [
      {
        name: "Custom Bars",
        method: "GET",
        path: "/v2/aggs/ticker/{indicesTicker}/range/{multiplier}/{timespan}/{from}/{to}",
        description:
          "Historical OHLC + value for an index over a custom range and interval (ET). Derived from index values, not trades. Empty intervals = no index updates in that window.",
        useCases: "Charting, trend analysis, benchmark comparisons, research and modeling.",
        docPath: "/rest/indices/aggregates/custom-bars",
      },
      {
        name: "Previous Day Bar",
        method: "GET",
        path: "/v2/aggs/ticker/{indicesTicker}/prev",
        description: "Previous session OHLC for baseline comparison.",
        useCases: "Baseline comparison, technical analysis, market research, daily reporting.",
        docPath: "/rest/indices/aggregates/previous-day-bar",
      },
      {
        name: "Daily Ticker Summary",
        method: "GET",
        path: "/v1/open-close/{indicesTicker}/{date}",
        description: "Open/close for an index on a date, plus pre-market and after-hours where applicable.",
        useCases: "Daily performance, historical collection, after-hours insights, portfolio tracking.",
        docPath: "/rest/indices/aggregates/daily-ticker-summary",
      },
    ],
  },
  {
    id: "snapshots",
    title: "Snapshots",
    endpoints: [
      {
        name: "Indices Snapshot",
        method: "GET",
        path: "/v3/snapshot/indices",
        description:
          "Snapshot for one or more indices — current value, recent performance, session details. Consolidates key index-level data in one request.",
        useCases: "Market condition assessment, sentiment tracking, portfolio context, integrated analysis.",
        docPath: "/rest/indices/snapshots/indices-snapshot",
      },
      {
        name: "Unified Snapshot",
        method: "GET",
        path: "/v3/snapshot",
        description: "Multi-asset snapshots (stocks, options, forex, crypto, indices) in one request.",
        useCases: "Cross-market analysis, diversified monitoring, global insights, multi-asset strategies.",
        docPath: "/rest/indices/snapshots/unified-snapshot",
      },
    ],
  },
  {
    id: "indicators",
    title: "Technical Indicators",
    endpoints: [
      {
        name: "SMA",
        method: "GET",
        path: "/v1/indicators/sma/{indicesTicker}",
        description: "Simple Moving Average over a defined range.",
        useCases: "Trend analysis, crossover signals, support/resistance, entry/exit timing.",
        docPath: "/rest/indices/technical-indicators/simple-moving-average",
      },
      {
        name: "EMA",
        method: "GET",
        path: "/v1/indicators/ema/{indicesTicker}",
        description: "Exponential Moving Average — heavier weight on recent prices.",
        useCases: "Trend identification, EMA crossovers, dynamic support/resistance.",
        docPath: "/rest/indices/technical-indicators/exponential-moving-average",
      },
      {
        name: "MACD",
        method: "GET",
        path: "/v1/indicators/macd/{indicesTicker}",
        description: "Moving Average Convergence/Divergence momentum indicator.",
        useCases: "Momentum analysis, crossover signals, overbought/oversold, trend confirmation.",
        docPath: "/rest/indices/technical-indicators/moving-average-convergence-divergence",
      },
      {
        name: "RSI",
        method: "GET",
        path: "/v1/indicators/rsi/{indicesTicker}",
        description: "Relative Strength Index (0–100).",
        useCases: "Overbought/oversold detection, divergence, trend confirmation.",
        docPath: "/rest/indices/technical-indicators/relative-strength-index",
      },
    ],
  },
  {
    id: "market-ops",
    title: "Market Operations",
    endpoints: [
      {
        name: "Market Holidays",
        method: "GET",
        path: "/v1/marketstatus/upcoming",
        description: "Forward-looking market holidays and open/close times.",
        useCases: "Schedule adjustments, holiday calendars, maintenance planning, user notifications.",
        docPath: "/rest/indices/market-operations/market-holidays",
      },
      {
        name: "Market Status",
        method: "GET",
        path: "/v1/marketstatus/now",
        description: "Real-time open/closed/pre-market/after-hours status.",
        useCases: "Real-time monitoring, algo scheduling, UI updates, operational planning.",
        docPath: "/rest/indices/market-operations/market-status",
      },
    ],
  },
];

export const INDICES_REST_TOC = INDICES_REST_SECTIONS.map((s) => ({
  id: s.id,
  title: s.title,
  count: s.endpoints.length,
}));
