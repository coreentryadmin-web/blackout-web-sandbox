import type { RestEndpointSection } from "@/lib/polygon-docs-rest-types";

export type { RestEndpointSection };

export const OPTIONS_REST_SECTIONS: RestEndpointSection[] = [
  {
    id: "contracts",
    title: "Contracts",
    endpoints: [
      {
        name: "All Contracts",
        method: "GET",
        path: "/v3/reference/options/contracts",
        description:
          "Comprehensive index of active and expired options contracts. Filter by underlying ticker. Each entry includes call/put, exercise style, expiration, and strike.",
        useCases: "Market availability, strategy development, research and modeling, contract exploration.",
        docPath: "/rest/options/contracts/all-contracts",
      },
      {
        name: "Contract Overview",
        method: "GET",
        path: "/v3/reference/options/contracts/{options_ticker}",
        description:
          "Single contract details: type, exercise style, expiration, strike, shares per contract, underlying ticker, primary exchange.",
        useCases: "Contract specs reference, chain analysis, strategy development, portfolio integration.",
        docPath: "/rest/options/contracts/contract-overview",
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
        path: "/v2/aggs/ticker/{optionsTicker}/range/{multiplier}/{timespan}/{from}/{to}",
        description:
          "Historical OHLC + volume for an options contract over a custom range and interval (ET). Empty intervals = no qualifying trades.",
        useCases: "Charting, technical analysis, backtesting, market research.",
        docPath: "/rest/options/aggregates/custom-bars",
      },
      {
        name: "Daily Ticker Summary",
        method: "GET",
        path: "/v1/open-close/{optionsTicker}/{date}",
        description: "Open/close for a contract on a date, plus pre-market and after-hours prices.",
        useCases: "Daily performance, historical collection, after-hours insights, portfolio tracking.",
        docPath: "/rest/options/aggregates/daily-ticker-summary",
      },
      {
        name: "Previous Day Bar",
        method: "GET",
        path: "/v2/aggs/ticker/{optionsTicker}/prev",
        description: "Previous session OHLC + volume for baseline comparison.",
        useCases: "Baseline comparison, technical analysis, market research, daily reporting.",
        docPath: "/rest/options/aggregates/previous-day-bar",
      },
    ],
  },
  {
    id: "snapshots",
    title: "Snapshots",
    endpoints: [
      {
        name: "Option Contract Snapshot",
        method: "GET",
        path: "/v3/snapshot/options/{underlyingAsset}/{optionContract}",
        description:
          "Full contract snapshot: break-even, day change, IV, open interest, greeks (delta, gamma, theta, vega), latest quote/trade, underlying price.",
        useCases: "Trade evaluation, market analysis, risk assessment, strategy refinement.",
        docPath: "/rest/options/snapshots/option-contract-snapshot",
      },
      {
        name: "Option Chain Snapshot",
        method: "GET",
        path: "/v3/snapshot/options/{underlyingAsset}",
        description:
          "Full chain for an underlying — pricing, greeks, IV, quotes, trades, OI, underlying price, break-even per contract.",
        useCases: "Market overview, strategy comparison, research and modeling, portfolio refinement.",
        docPath: "/rest/options/snapshots/option-chain-snapshot",
      },
      {
        name: "Unified Snapshot",
        method: "GET",
        path: "/v3/snapshot",
        description: "Multi-asset snapshots (stocks, options, forex, crypto) in one request.",
        useCases: "Cross-market analysis, diversified monitoring, global insights, multi-asset strategies.",
        docPath: "/rest/options/snapshots/unified-snapshot",
      },
    ],
  },
  {
    id: "trades-quotes",
    title: "Trades & Quotes",
    endpoints: [
      {
        name: "Trades",
        method: "GET",
        path: "/v3/trades/{optionsTicker}",
        description: "Tick-level options trade history: price, size, exchange, conditions, timestamps.",
        useCases: "Intraday analysis, algo trading, microstructure research, compliance.",
        docPath: "/rest/options/trades-quotes/trades",
      },
      {
        name: "Last Trade",
        method: "GET",
        path: "/v2/last/trade/{optionsTicker}",
        description: "Most recent trade for an options contract.",
        useCases: "Trade monitoring, price updates, market snapshot.",
        docPath: "/rest/options/trades-quotes/last-trade",
      },
      {
        name: "Quotes",
        method: "GET",
        path: "/v3/quotes/{optionsTicker}",
        description: "Historical quotes — bid/ask, sizes, exchanges, timestamps for strikes and expirations.",
        useCases: "Quote analysis, market interest evaluation, algo backtesting, strategy refinement.",
        docPath: "/rest/options/trades-quotes/quotes",
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
        path: "/v1/indicators/sma/{optionsTicker}",
        description: "Simple Moving Average over a defined range.",
        useCases: "Trend analysis, crossover signals, support/resistance, entry/exit timing.",
        docPath: "/rest/options/technical-indicators/simple-moving-average",
      },
      {
        name: "EMA",
        method: "GET",
        path: "/v1/indicators/ema/{optionsTicker}",
        description: "Exponential Moving Average — heavier weight on recent prices.",
        useCases: "Trend identification, EMA crossovers, dynamic support/resistance.",
        docPath: "/rest/options/technical-indicators/exponential-moving-average",
      },
      {
        name: "MACD",
        method: "GET",
        path: "/v1/indicators/macd/{optionsTicker}",
        description: "Moving Average Convergence/Divergence momentum indicator.",
        useCases: "Momentum analysis, crossover signals, overbought/oversold, trend confirmation.",
        docPath: "/rest/options/technical-indicators/moving-average-convergence-divergence",
      },
      {
        name: "RSI",
        method: "GET",
        path: "/v1/indicators/rsi/{optionsTicker}",
        description: "Relative Strength Index (0–100).",
        useCases: "Overbought/oversold detection, divergence, trend confirmation.",
        docPath: "/rest/options/technical-indicators/relative-strength-index",
      },
    ],
  },
  {
    id: "market-ops",
    title: "Market Operations",
    endpoints: [
      {
        name: "Exchanges",
        method: "GET",
        path: "/v3/reference/exchanges",
        description: "Known exchanges with identifiers, names, market types, and attributes.",
        useCases: "Data mapping, market coverage, app development, regulatory compliance.",
        docPath: "/rest/options/market-operations/exchanges",
      },
      {
        name: "Market Holidays",
        method: "GET",
        path: "/v1/marketstatus/upcoming",
        description: "Forward-looking market holidays and open/close times.",
        useCases: "Schedule adjustments, holiday calendars, maintenance planning, user notifications.",
        docPath: "/rest/options/market-operations/market-holidays",
      },
      {
        name: "Market Status",
        method: "GET",
        path: "/v1/marketstatus/now",
        description: "Real-time open/closed/pre-market/after-hours status.",
        useCases: "Real-time monitoring, algo scheduling, UI updates, operational planning.",
        docPath: "/rest/options/market-operations/market-status",
      },
      {
        name: "Condition Codes",
        method: "GET",
        path: "/v3/reference/conditions",
        description: "Unified trade and quote conditions from CTA, UTP, OPRA, FINRA.",
        useCases: "Data interpretation, filtering, algo adjustments, compliance.",
        docPath: "/rest/options/market-operations/condition-codes",
      },
    ],
  },
];

export const OPTIONS_REST_TOC = OPTIONS_REST_SECTIONS.map((s) => ({
  id: s.id,
  title: s.title,
  count: s.endpoints.length,
}));
