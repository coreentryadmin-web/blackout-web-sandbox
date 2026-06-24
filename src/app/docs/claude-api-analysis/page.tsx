import Link from "next/link";

export const revalidate = 0;

type ApiEndpoint = {
  method: "GET" | "POST" | "WS" | "SSE";
  path: string;
  usedFor: string;
  file: string;
  live?: boolean; // actively polled in play engine
};

type ApiSection = {
  id: string;
  title: string;
  endpoints: ApiEndpoint[];
};

// ─── Polygon / Massive ─────────────────────────────────────────────────────

const POLYGON_REST: ApiSection[] = [
  {
    id: "polygon-snapshots",
    title: "Snapshots",
    endpoints: [
      { method: "GET", path: "/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}", usedFor: "Single stock snapshot (price, volume, change)", file: "providers/polygon.ts", live: true },
      { method: "GET", path: "/v2/snapshot/locale/us/markets/stocks/tickers", usedFor: "Batch stock snapshots (heatmap movers)", file: "providers/polygon.ts", live: true },
      { method: "GET", path: "/v2/snapshot/locale/us/markets/stocks/gainers", usedFor: "Market gainers list", file: "providers/polygon.ts" },
      { method: "GET", path: "/v2/snapshot/locale/us/markets/stocks/losers", usedFor: "Market losers list", file: "providers/polygon.ts" },
      { method: "GET", path: "/v3/snapshot/indices", usedFor: "Index snapshots — SPX, VIX, VIX9D, VIX3M", file: "providers/polygon.ts", live: true },
    ],
  },
  {
    id: "polygon-aggs",
    title: "Aggregates & Indicators",
    endpoints: [
      { method: "GET", path: "/v2/aggs/ticker/{ticker}/range/1/minute/{from}/{to}", usedFor: "1-minute bars for intraday technicals", file: "providers/polygon-largo.ts", live: true },
      { method: "GET", path: "/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}", usedFor: "Daily bars for multi-day analysis", file: "providers/polygon.ts" },
      { method: "GET", path: "/v2/aggs/ticker/{ticker}/prev", usedFor: "Previous day bar (PDH/PDL/prior close)", file: "providers/polygon-largo.ts", live: true },
      { method: "GET", path: "/v1/indicators/ema/{ticker}", usedFor: "EMA 20/50/200 for structure levels", file: "providers/polygon.ts", live: true },
      { method: "GET", path: "/v1/indicators/rsi/{ticker}", usedFor: "RSI for momentum (warning-only, not blocking)", file: "providers/polygon.ts", live: true },
      { method: "GET", path: "/v1/indicators/sma/{ticker}", usedFor: "SMA 50/200 for structure levels", file: "providers/polygon-largo.ts" },
      { method: "GET", path: "/v1/indicators/macd/{ticker}", usedFor: "MACD for trend confirmation", file: "providers/polygon-largo.ts" },
    ],
  },
  {
    id: "polygon-options",
    title: "Options Chains & GEX",
    endpoints: [
      { method: "GET", path: "/v3/snapshot/options/{underlying}", usedFor: "Full options chain with greeks, IV, OI — used for GEX computation", file: "providers/polygon-options-gex.ts", live: true },
      { method: "GET", path: "/v3/reference/options/contracts", usedFor: "Reference options contracts list", file: "providers/polygon-options-gex.ts" },
    ],
  },
  {
    id: "polygon-reference",
    title: "Reference & Market Status",
    endpoints: [
      { method: "GET", path: "/v1/marketstatus/now", usedFor: "Market open/closed state (RTH, pre/after hours)", file: "providers/polygon.ts", live: true },
      { method: "GET", path: "/v1/marketstatus/upcoming", usedFor: "Upcoming market holidays", file: "providers/polygon-largo.ts" },
      { method: "GET", path: "/v3/reference/tickers/{ticker}", usedFor: "Ticker details — name, exchange, description", file: "providers/polygon-largo.ts" },
      { method: "GET", path: "/v3/reference/tickers/{ticker}/related", usedFor: "Related tickers (peer discovery)", file: "providers/polygon-largo.ts" },
      { method: "GET", path: "/v2/last/nbbo/{ticker}", usedFor: "Last NBBO bid/ask spread", file: "providers/polygon-largo.ts" },
      { method: "GET", path: "/v2/last/trade/{ticker}", usedFor: "Last trade price", file: "providers/polygon-largo.ts" },
      { method: "GET", path: "/v1/open-close/{ticker}/{date}", usedFor: "Open/close data for a specific date", file: "providers/polygon-largo.ts" },
      { method: "GET", path: "/stocks/v1/float", usedFor: "Stock float size", file: "providers/polygon-largo.ts" },
    ],
  },
  {
    id: "polygon-short",
    title: "Short Data",
    endpoints: [
      { method: "GET", path: "/stocks/v1/short-interest", usedFor: "Short interest data", file: "providers/polygon.ts" },
      { method: "GET", path: "/stocks/v1/short-volume", usedFor: "Short volume data", file: "providers/polygon.ts" },
    ],
  },
  {
    id: "polygon-news",
    title: "News",
    endpoints: [
      { method: "GET", path: "/benzinga/v2/news", usedFor: "Real-time Benzinga news for desk feed + catalyst detection", file: "providers/polygon.ts", live: true },
      { method: "GET", path: "/v2/reference/news", usedFor: "Polygon news feed (secondary)", file: "providers/polygon-largo.ts" },
    ],
  },
];

const POLYGON_WS: ApiEndpoint[] = [
  { method: "WS", path: "wss://socket.massive.com/stocks", usedFor: "Real-time stocks — AM, A, T, Q, LULD, NOI, FMV", file: "providers/polygon-docs-nav.ts" },
  { method: "WS", path: "wss://socket.massive.com/options", usedFor: "Real-time options — AM, A, T, Q, FMV", file: "providers/polygon-docs-nav.ts" },
  { method: "WS", path: "wss://socket.massive.com/indices", usedFor: "Real-time indices — AM, A, V (SPX, VIX pulses)", file: "providers/polygon-docs-nav.ts" },
];

// ─── Unusual Whales ─────────────────────────────────────────────────────────

const UW_SECTIONS: ApiSection[] = [
  {
    id: "uw-gex",
    title: "GEX / Greeks",
    endpoints: [
      { method: "GET", path: "/api/stock/{ticker}/gex-levels", usedFor: "Key GEX support/resistance levels for the engine", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/stock/{ticker}/spot-exposures/expiry-strike", usedFor: "Spot GEX by expiry+strike — used for 0DTE wall detection", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/stock/{ticker}/spot-exposures/strike", usedFor: "Full GEX ladder by strike (GEX king / gamma flip)", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/stock/{ticker}/spot-exposures/{expiry}/strike", usedFor: "Spot exposures by expiry/strike (deprecated — v1)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/greek-exposure/expiry", usedFor: "Greek exposure by expiry date", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/stock/{ticker}/greek-exposure/strike", usedFor: "Static GEX by strike for positioning context", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/greek-flow", usedFor: "Greek delta flow (not yet used in SPX engine)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/greek-flow/{expiry}", usedFor: "Greek flow per expiry", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/greeks", usedFor: "Greeks by strike for chain display", file: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-flow",
    title: "Options Flow",
    endpoints: [
      { method: "GET", path: "/api/option-trades/flow-alerts", usedFor: "Market-wide unusual flow alerts — primary flow signal in SPX engine", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/stock/{ticker}/flow-alerts", usedFor: "Per-ticker flow alerts", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/stock/{ticker}/flow-per-strike-intraday", usedFor: "Intraday flow premium by strike — strike stack heatmap", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/stock/{ticker}/flow-per-strike", usedFor: "Flow per strike (daily aggregate)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/flow-per-expiry", usedFor: "Flow premium by expiration", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/flow-recent", usedFor: "Recent flow prints for tape", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/net-prem-ticks", usedFor: "Tick-level net premium velocity — call/put pressure ticks", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/option-contract/{contractId}/flow", usedFor: "Flow data for a specific contract", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/net-flow/expiry", usedFor: "Net flow by expiration", file: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-tide",
    title: "Market Tide & NOPE",
    endpoints: [
      { method: "GET", path: "/api/market/market-tide", usedFor: "Aggregate call/put premium bias — hard-opposing factor in SPX engine (2× conflict weight)", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/market/{sector}/sector-tide", usedFor: "Sector call/put premium tide", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/market/{ticker}/etf-tide", usedFor: "ETF tide (SPY, QQQ, IWM)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/nope", usedFor: "NOPE (net options premium exposure) — delta-weighted flow signal", file: "providers/unusual-whales.ts", live: true },
    ],
  },
  {
    id: "uw-darkpool",
    title: "Dark Pool",
    endpoints: [
      { method: "GET", path: "/api/darkpool/{ticker}", usedFor: "Per-ticker dark pool prints — hard-opposing factor (2× weight) in SPX engine", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/darkpool/recent", usedFor: "Market-wide dark pool prints for tape", file: "providers/unusual-whales.ts", live: true },
    ],
  },
  {
    id: "uw-volatility",
    title: "Volatility",
    endpoints: [
      { method: "GET", path: "/api/stock/{ticker}/volatility/stats", usedFor: "IV rank — hard-opposing factor in SPX engine (2× weight)", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/stock/{ticker}/iv-rank", usedFor: "Daily IV rank time series", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/interpolated-iv", usedFor: "Interpolated IV + percentile for chain display", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/volatility/term-structure", usedFor: "IV term structure curve", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/volatility/realized", usedFor: "Realized volatility (HV)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/volatility/anomaly", usedFor: "Volatility anomaly score", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/volatility/character", usedFor: "Vol character (realized vs implied)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/volatility/variance-risk-premium", usedFor: "Variance risk premium", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/historical-risk-reversal-skew", usedFor: "Risk reversal skew", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/volatility/vix-term-structure", usedFor: "VIX9D / VIX3M term structure (contango/backwardation)", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/volatility/anomaly/top", usedFor: "Top volatility anomalies market-wide", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/volatility/character/top", usedFor: "Top vol character movers", file: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-options",
    title: "Options Chains & OI",
    endpoints: [
      { method: "GET", path: "/api/stock/{ticker}/option-contracts", usedFor: "Live NBBO options chain (real-time greeks + IV)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/option-chains", usedFor: "Full option chains with OI", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/atm-chains", usedFor: "At-the-money chains display", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/oi-change", usedFor: "Intraday OI changes by strike", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/stock/{ticker}/oi-per-strike", usedFor: "OI aggregated by strike", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/oi-per-expiry", usedFor: "OI by expiration date", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/options-volume", usedFor: "Options volume by contract", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/option/volume-oi-expiry", usedFor: "Volume & OI combined by expiry", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/expiry-breakdown", usedFor: "Expiry breakdown for chain analysis", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/max-pain", usedFor: "Max pain by expiry — level used in desk structure", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/option-contract/{contractId}/intraday", usedFor: "Contract intraday price/volume data", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/option-contract/{contractId}/volume-profile", usedFor: "Contract volume profile", file: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-market",
    title: "Market-Wide",
    endpoints: [
      { method: "GET", path: "/api/market/movers", usedFor: "Top market movers for heatmap", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/market/oi-change", usedFor: "Market-wide OI changes", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/market/total-options-volume", usedFor: "Total market options volume", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/market/top-net-impact", usedFor: "Top net-impact trades", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/market/correlations", usedFor: "Cross-asset correlations", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/market/economic-calendar", usedFor: "Economic events calendar — macro gate data", file: "providers/unusual-whales.ts", live: true },
      { method: "GET", path: "/api/market/fda-calendar", usedFor: "FDA approval calendar", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/market/sector-etfs", usedFor: "Sector ETF reference list", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/news/headlines", usedFor: "Market/ticker news for desk + news-guard confirmations", file: "providers/unusual-whales.ts", live: true },
    ],
  },
  {
    id: "uw-screener",
    title: "Screeners",
    endpoints: [
      { method: "GET", path: "/api/screener/stocks", usedFor: "Stock screener", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/screener/option-contracts", usedFor: "Hottest option contracts screener (Hottest Chains)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/screener/analysts", usedFor: "Analyst consensus screener", file: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-stock",
    title: "Stock Fundamentals & Info",
    endpoints: [
      { method: "GET", path: "/api/stock/{ticker}/info", usedFor: "Stock fundamental info (sector, market cap)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/stock-state", usedFor: "Full stock state snapshot", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/ohlc/{candleSize}", usedFor: "OHLC candle data", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/insider-buy-sells", usedFor: "Insider buy/sell flow", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/ownership", usedFor: "Ownership structure", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/fundamental-breakdown", usedFor: "Fundamental breakdown display", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/financials", usedFor: "Financial statements", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/income-statements", usedFor: "Income statements", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/balance-sheets", usedFor: "Balance sheets", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/cash-flows", usedFor: "Cash flow statements", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/technical-indicator/{fn}", usedFor: "Technical indicators via UW (RSI, MACD, SMA)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/stock/{ticker}/earnings", usedFor: "Earnings history", file: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-short",
    title: "Short Data",
    endpoints: [
      { method: "GET", path: "/api/shorts/{ticker}/interest-float/v2", usedFor: "Short float data (v2)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/shorts/{ticker}/volume-and-ratio", usedFor: "Short volume and ratio", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/shorts/{ticker}/volumes-by-exchange", usedFor: "Short volumes by exchange", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/shorts/{ticker}/ftds", usedFor: "Failures to deliver", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/shorts/{ticker}/data", usedFor: "Short data aggregated", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/short_screener", usedFor: "Short screener", file: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-company",
    title: "Companies, ETFs & Institutions",
    endpoints: [
      { method: "GET", path: "/api/companies/{ticker}/dividends", usedFor: "Dividend history", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/companies/{ticker}/splits", usedFor: "Stock split history", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/companies/{ticker}/profile", usedFor: "Company profile", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/companies/{ticker}/earnings-estimates", usedFor: "Forward earnings estimates", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/earnings/premarket", usedFor: "Pre-market earnings calendar", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/earnings/afterhours", usedFor: "After-hours earnings calendar", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/earnings/{ticker}", usedFor: "Historical earnings for ticker", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/etfs/{etf}/holdings", usedFor: "ETF holdings breakdown", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/etfs/{etf}/exposure", usedFor: "ETF exposure breakdown", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/etfs/{etf}/info", usedFor: "ETF information", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/etfs/{etf}/weights", usedFor: "ETF sector/country weights", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/etfs/{etf}/in-outflow", usedFor: "ETF inflow/outflow", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/market/{ticker}/etf-tide", usedFor: "ETF tide (SPY, QQQ, IWM)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/institution/{name}/activity/v2", usedFor: "Institutional activity (v2)", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/institution/{name}/holdings", usedFor: "Institutional holdings", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/institutions/latest_filings", usedFor: "Latest 13F filings", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/institution/{ticker}/ownership", usedFor: "Institutional ownership by ticker", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/seasonality/{ticker}/monthly", usedFor: "Monthly seasonality patterns", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/seasonality/market", usedFor: "Market-wide seasonality", file: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-congress",
    title: "Congress & Insiders",
    endpoints: [
      { method: "GET", path: "/api/congress/recent-trades", usedFor: "Recent congress trades", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/congress/unusual-trades", usedFor: "Unusual congressional trades", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/congress/late-reports", usedFor: "Congress late trade reports", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/congress/politicians", usedFor: "Politicians with trade data", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/insider/transactions", usedFor: "Insider transactions", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/insider/{ticker}", usedFor: "Insider data by ticker", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/insider/{sector}/sector-flow", usedFor: "Insider flow by sector", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/market/insider-buy-sells", usedFor: "Total market insider buy/sells", file: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-lit",
    title: "Lit Flow",
    endpoints: [
      { method: "GET", path: "/api/lit-flow/recent", usedFor: "Recent lit flow trades", file: "providers/unusual-whales.ts" },
      { method: "GET", path: "/api/lit-flow/{ticker}", usedFor: "Lit flow by ticker", file: "providers/unusual-whales.ts" },
    ],
  },
];

// ─── Anthropic ─────────────────────────────────────────────────────────────

const ANTHROPIC_ENDPOINTS: ApiEndpoint[] = [
  { method: "POST", path: "/v1/messages", usedFor: "Desk commentary, dossier generation, play narratives", file: "providers/anthropic.ts", live: true },
  { method: "POST", path: "/v1/messages (tool_use)", usedFor: "Agentic multi-turn reasoning (Night Hawk hunt)", file: "providers/anthropic.ts" },
];

// ─── Web Search ─────────────────────────────────────────────────────────────

const WEBSEARCH_ENDPOINTS: ApiEndpoint[] = [
  { method: "POST", path: "https://api.tavily.com/search", usedFor: "AI-summarized web search (Night Hawk research)", file: "providers/web-search.ts" },
  { method: "POST", path: "https://google.serper.dev/search", usedFor: "Google SERP results (fallback)", file: "providers/web-search.ts" },
  { method: "GET", path: "https://api.search.brave.com/res/v1/web/search", usedFor: "Brave search (fallback)", file: "providers/web-search.ts" },
];

// ─── Internal Routes ─────────────────────────────────────────────────────────

const INTERNAL_ROUTES: ApiEndpoint[] = [
  { method: "GET", path: "/api/market/spx/desk", usedFor: "Full SPX desk (Polygon + UW merged, ~10s poll)", file: "app/api/market/spx/desk/route.ts", live: true },
  { method: "GET", path: "/api/market/spx/pulse", usedFor: "Fast Polygon price/structure pulse (~2s)", file: "app/api/market/spx/pulse/route.ts", live: true },
  { method: "GET", path: "/api/market/spx/flow", usedFor: "UW flow lane — alerts, dark pool, tide, GEX (~4s)", file: "app/api/market/spx/flow/route.ts", live: true },
  { method: "GET", path: "/api/market/spx/play", usedFor: "SPX play engine signals (state machine evaluation)", file: "app/api/market/spx/play/route.ts", live: true },
  { method: "GET", path: "/api/market/spx/merged", usedFor: "Merged desk payload (desk + flow + pulse)", file: "app/api/market/spx/merged/route.ts" },
  { method: "GET", path: "/api/lotto/today", usedFor: "Lotto play signals (parallel 0DTE engine)", file: "app/api/lotto/today/route.ts", live: true },
  { method: "GET", path: "/api/market/indices", usedFor: "SPX/VIX/NDX index snapshots", file: "app/api/market/indices/route.ts" },
  { method: "GET", path: "/api/market/heatmap", usedFor: "Sector/mover heatmap data", file: "app/api/market/heatmap/route.ts" },
  { method: "GET", path: "/api/market/news", usedFor: "Aggregated market news (Benzinga + UW)", file: "app/api/market/news/route.ts" },
  { method: "GET", path: "/api/market/flows", usedFor: "Flow alerts stream", file: "app/api/market/flows/route.ts" },
  { method: "SSE", path: "/api/market/flows/stream", usedFor: "Live flow alerts — Server-Sent Events push", file: "app/api/market/flows/stream/route.ts", live: true },
  { method: "GET", path: "/api/market/health", usedFor: "Provider health status (Polygon + UW latency)", file: "app/api/market/health/route.ts" },
  { method: "GET", path: "/api/nighthawk/edition", usedFor: "Night Hawk evening edition", file: "app/api/nighthawk/edition/route.ts" },
  { method: "POST", path: "/api/nighthawk/hunt", usedFor: "Night Hawk agentic ticker research", file: "app/api/nighthawk/hunt/route.ts" },
  { method: "POST", path: "/api/market/spx/commentary", usedFor: "Claude desk commentary (AI narrative)", file: "app/api/market/spx/commentary/route.ts" },
  { method: "POST", path: "/api/webhook/whop", usedFor: "Whop membership webhook (subscription sync)", file: "app/api/webhook/whop/route.ts" },
];

// ─── Render helpers ──────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  GET: "#00e676",
  POST: "#3b82f6",
  WS: "#a855f7",
  SSE: "#ffd23f",
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        background: METHOD_COLORS[method] ?? "#0369a1",
        color: "#fff",
        minWidth: 36,
        textAlign: "center",
      }}
    >
      {method}
    </span>
  );
}

function LiveDot() {
  return (
    <span
      title="Polled live in play engine"
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: "#00e676",
        marginLeft: 5,
        verticalAlign: "middle",
      }}
    />
  );
}

function EndpointRow({ ep }: { ep: ApiEndpoint }) {
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>
        <MethodBadge method={ep.method} />
        {ep.live && <LiveDot />}
      </td>
      <td>
        <code style={{ fontSize: 12 }}>{ep.path}</code>
      </td>
      <td style={{ fontSize: 13 }}>{ep.usedFor}</td>
      <td style={{ fontSize: 11, opacity: 0.6, whiteSpace: "nowrap" }}>{ep.file}</td>
    </tr>
  );
}

function SectionTable({ section }: { section: ApiSection }) {
  return (
    <div id={section.id} style={{ marginBottom: "2rem" }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: "0.5rem" }}>{section.title}</h3>
      <table className="docs-table" style={{ width: "100%", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ width: 80 }}>Method</th>
            <th>Path</th>
            <th>Used for</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          {section.endpoints.map((ep) => (
            <EndpointRow key={`${ep.method}-${ep.path}`} ep={ep} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlatTable({ endpoints, title, id }: { endpoints: ApiEndpoint[]; title: string; id: string }) {
  return (
    <div id={id} style={{ marginBottom: "2rem" }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: "0.5rem" }}>{title}</h3>
      <table className="docs-table" style={{ width: "100%", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ width: 80 }}>Method</th>
            <th>Path / URL</th>
            <th>Used for</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((ep) => (
            <EndpointRow key={`${ep.method}-${ep.path}`} ep={ep} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Counts ──────────────────────────────────────────────────────────────────

const polygonRestCount = POLYGON_REST.reduce((n, s) => n + s.endpoints.length, 0);
const uwCount = UW_SECTIONS.reduce((n, s) => n + s.endpoints.length, 0);
const totalCount = polygonRestCount + POLYGON_WS.length + uwCount + ANTHROPIC_ENDPOINTS.length + WEBSEARCH_ENDPOINTS.length;
const liveCount = [
  ...POLYGON_REST.flatMap((s) => s.endpoints),
  ...POLYGON_WS,
  ...UW_SECTIONS.flatMap((s) => s.endpoints),
  ...ANTHROPIC_ENDPOINTS,
  ...INTERNAL_ROUTES,
].filter((e) => e.live).length;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ClaudeApiAnalysisPage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">Blackout · Internal Reference</p>
        <h1 className="docs-title">Full API Endpoint Catalog</h1>
        <p className="docs-lead">
          Every external and internal API endpoint used across the entire BlackOut codebase —{" "}
          <strong>{totalCount} external endpoints</strong> across 4 providers, audited file-by-file.{" "}
          <span style={{ color: "#00e676" }}>●</span> Live = polled in the real-time play engine.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          <Link href="/docs/polygon" className="docs-back-link">Polygon / Massive docs →</Link>
          <Link href="/docs/unusual-whales" className="docs-back-link">Unusual Whales docs →</Link>
        </div>
      </header>

      {/* Summary table */}
      <section className="docs-section">
        <h2>Provider summary</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Endpoints</th>
              <th>Protocols</th>
              <th>Env vars</th>
              <th>Base URL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Polygon / Massive</strong></td>
              <td>{polygonRestCount} REST + {POLYGON_WS.length} WS</td>
              <td>HTTPS · WSS</td>
              <td><code>POLYGON_API_KEY</code> / <code>MASSIVE_API_KEY</code></td>
              <td><code>api.massive.com</code></td>
            </tr>
            <tr>
              <td><strong>Unusual Whales</strong></td>
              <td>{uwCount} REST (WS available but not used)</td>
              <td>HTTPS</td>
              <td><code>UW_API_KEY</code> · <code>UW_CLIENT_API_ID</code></td>
              <td><code>api.unusualwhales.com</code></td>
            </tr>
            <tr>
              <td><strong>Anthropic</strong></td>
              <td>{ANTHROPIC_ENDPOINTS.length} REST</td>
              <td>HTTPS</td>
              <td><code>ANTHROPIC_API_KEY</code> · <code>ANTHROPIC_MODEL</code></td>
              <td><code>api.anthropic.com</code></td>
            </tr>
            <tr>
              <td><strong>Web search</strong></td>
              <td>{WEBSEARCH_ENDPOINTS.length} REST</td>
              <td>HTTPS</td>
              <td><code>TAVILY_API_KEY</code> / <code>SERPER_API_KEY</code> / <code>BRAVE_SEARCH_API_KEY</code></td>
              <td>Various</td>
            </tr>
            <tr>
              <td><strong>Internal routes</strong></td>
              <td>{INTERNAL_ROUTES.length} routes</td>
              <td>HTTPS · SSE</td>
              <td>—</td>
              <td>/api/…</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Legend */}
      <section className="docs-section">
        <h2>Legend</h2>
        <div style={{ display: "flex", gap: "1.5rem", fontSize: 13, flexWrap: "wrap" }}>
          <span><MethodBadge method="GET" /> Standard REST read</span>
          <span><MethodBadge method="POST" /> REST write / AI generate</span>
          <span><MethodBadge method="WS" /> WebSocket stream</span>
          <span><MethodBadge method="SSE" /> Server-Sent Events</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#00e676", verticalAlign: "middle" }} /> Polled live in play engine</span>
        </div>
      </section>

      {/* ── Polygon / Massive ── */}
      <section className="docs-section">
        <h2 id="polygon">1. Polygon / Massive</h2>
        <p style={{ fontSize: 13, opacity: 0.75, marginBottom: "1rem" }}>
          Primary data provider — all quotes, aggs, options chains, GEX computation, indices, and Benzinga news.
          Polygon.io rebranded to Massive — <code>api.massive.com</code> with the same API key.
        </p>
        {POLYGON_REST.map((s) => <SectionTable key={s.id} section={s} />)}
        <FlatTable endpoints={POLYGON_WS} title="WebSocket streams" id="polygon-ws" />
      </section>

      {/* ── Unusual Whales ── */}
      <section className="docs-section">
        <h2 id="uw">2. Unusual Whales</h2>
        <p style={{ fontSize: 13, opacity: 0.75, marginBottom: "1rem" }}>
          Flow-only provider — options flow alerts, dark pool prints, market/sector tide, NOPE, and IV rank.
          {" "}{uwCount} endpoints cataloged; real-time WebSocket API available but not yet wired (currently REST-polled at 2s).
        </p>
        {UW_SECTIONS.map((s) => <SectionTable key={s.id} section={s} />)}
      </section>

      {/* ── Anthropic ── */}
      <section className="docs-section">
        <h2 id="anthropic">3. Anthropic</h2>
        <p style={{ fontSize: 13, opacity: 0.75, marginBottom: "1rem" }}>
          Claude model for desk commentary, Night Hawk dossiers, play narratives, and agentic ticker research.
          Model set via <code>ANTHROPIC_MODEL</code> (default: <code>claude-sonnet-4-20250514</code>).
        </p>
        <FlatTable endpoints={ANTHROPIC_ENDPOINTS} title="REST endpoints" id="anthropic-rest" />
      </section>

      {/* ── Web Search ── */}
      <section className="docs-section">
        <h2 id="websearch">5. Web Search (Night Hawk)</h2>
        <p style={{ fontSize: 13, opacity: 0.75, marginBottom: "1rem" }}>
          Used by Night Hawk for real-time ticker research. Checks Tavily first, falls back to Serper, then Brave.
          Only one key needs to be set.
        </p>
        <FlatTable endpoints={WEBSEARCH_ENDPOINTS} title="REST endpoints" id="websearch-rest" />
      </section>

      {/* ── Internal ── */}
      <section className="docs-section">
        <h2 id="internal">6. Internal API Routes</h2>
        <p style={{ fontSize: 13, opacity: 0.75, marginBottom: "1rem" }}>
          Next.js server-side routes that aggregate external API calls. Client components poll these — never the
          external APIs directly.
        </p>
        <FlatTable endpoints={INTERNAL_ROUTES} title="Server routes" id="internal-routes" />
      </section>

      {/* ── Gaps / Opportunities ── */}
      <section className="docs-section">
        <h2 id="gaps">Unused / upgrade opportunities</h2>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Provider</th>
              <th>Opportunity</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>/api/socket/flow_alerts</code></td>
              <td>UW WebSocket</td>
              <td>Real-time flow push — currently REST-polled at 2s. Sub-second push would sharpen entry timing significantly.</td>
              <td>🔴 High</td>
            </tr>
            <tr>
              <td><code>/api/socket/market_tide</code></td>
              <td>UW WebSocket</td>
              <td>Real-time tide vs 2s REST poll — tide is a 2× hard-opposing factor; stale reads can block valid setups.</td>
              <td>🔴 High</td>
            </tr>
            <tr>
              <td><code>/api/socket/gex</code></td>
              <td>UW WebSocket</td>
              <td>Real-time GEX wall updates — gamma flip / king level changes currently lag by one poll cycle.</td>
              <td>🟡 Medium</td>
            </tr>
            <tr>
              <td><code>/api/socket/net_flow</code></td>
              <td>UW WebSocket</td>
              <td>Real-time net 0DTE flow — replaces the REST <code>flow_0dte_net</code> polling in the flow lane.</td>
              <td>🟡 Medium</td>
            </tr>
            <tr>
              <td><code>/api/stock/{"{ticker}"}/spot-exposures</code></td>
              <td>UW REST</td>
              <td>Per-1min spot GEX at current price — better than static GEX levels for intraday dealer positioning signals.</td>
              <td>🟡 Medium</td>
            </tr>
            <tr>
              <td><code>/api/socket/interval_flow</code></td>
              <td>UW WebSocket</td>
              <td>Ticker interval flow via WS — real-time strike-level flow (replaces <code>flow-per-strike-intraday</code> REST poll).</td>
              <td>🟢 Low</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
