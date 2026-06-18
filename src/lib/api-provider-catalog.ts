import type { ApiProviderId } from "@/lib/api-telemetry-types";

export type CatalogEndpoint = {
  endpoint: string;
  method: string;
  description: string;
  used_by: string[];
};

export type ApiProviderCatalogEntry = {
  id: ApiProviderId;
  name: string;
  description: string;
  docs_url: string | null;
  env_keys: string[];
  endpoints: CatalogEndpoint[];
};

export const API_PROVIDER_CATALOG: ApiProviderCatalogEntry[] = [
  {
    id: "polygon",
    name: "Polygon / Massive",
    description: "Index & equity snapshots, bars, indicators, news, options chain.",
    docs_url: "https://polygon.io/docs",
    env_keys: ["POLYGON_API_KEY", "POLYGON_API_BASE"],
    endpoints: [
      {
        endpoint: "/v2/snapshot/locale/us/markets/stocks/tickers",
        method: "GET",
        description: "Stock snapshot (leaders, breadth, SPY gap proxy)",
        used_by: ["desk pulse", "gap proxy", "breadth"],
      },
      {
        endpoint: "/v3/snapshot/indices",
        method: "GET",
        description: "Index snapshots — SPX, VIX, VIX9D, VIX3M",
        used_by: ["desk pulse", "internals"],
      },
      {
        endpoint: "/benzinga/v2/news",
        method: "GET",
        description: "Benzinga headline feed",
        used_by: ["news rail"],
      },
      {
        endpoint: "/v2/aggs/ticker/{symbol}/range/1/minute/{from}/{to}",
        method: "GET",
        description: "Intraday 1-minute bars",
        used_by: ["SPX structure", "EMA inputs"],
      },
      {
        endpoint: "/v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}",
        method: "GET",
        description: "Daily bars (prior close, structure)",
        used_by: ["SPX structure"],
      },
      {
        endpoint: "/v1/indicators/ema/{symbol}",
        method: "GET",
        description: "EMA indicator",
        used_by: ["desk pulse"],
      },
      {
        endpoint: "/v1/indicators/sma/{symbol}",
        method: "GET",
        description: "SMA indicator",
        used_by: ["desk pulse"],
      },
      {
        endpoint: "/v2/aggs/ticker/{symbol}/range/1/minute/{from}/{to}",
        method: "GET",
        description: "Session VWAP (computed from RTH minute bars — no Polygon VWAP indicator for indices)",
        used_by: ["desk pulse"],
      },
      {
        endpoint: "/v1/marketstatus/now",
        method: "GET",
        description: "Market open / extended / closed",
        used_by: ["session guards", "health probe"],
      },
      {
        endpoint: "/v3/snapshot/options/{underlying}",
        method: "GET",
        description: "Options chain snapshot for 0DTE GEX",
        used_by: ["Polygon GEX fallback"],
      },
    ],
  },
  {
    id: "unusual_whales",
    name: "Unusual Whales",
    description: "Options flow, GEX, dark pool, market tide, IV — UW Advanced ($375/mo) live REST + WebSocket.",
    docs_url: "https://api.unusualwhales.com/docs",
    env_keys: ["UW_API_KEY", "UW_API_BASE"],
    endpoints: [
      {
        endpoint: "/api/option-trades/flow-alerts",
        method: "GET",
        description: "Global options flow alerts",
        used_by: ["flow ingest", "market flows API"],
      },
      {
        endpoint: "/api/market/market-tide",
        method: "GET",
        description: "Market-wide call/put tide",
        used_by: ["desk flow lane"],
      },
      {
        endpoint: "/api/stock/{ticker}/spot-exposures/expiry-strike",
        method: "GET",
        description: "GEX by expiry & strike",
        used_by: ["desk GEX"],
      },
      {
        endpoint: "/api/stock/{ticker}/spot-exposures/strike",
        method: "GET",
        description: "Spot GEX by strike",
        used_by: ["desk GEX"],
      },
      {
        endpoint: "/api/stock/{ticker}/max-pain",
        method: "GET",
        description: "Max pain strike",
        used_by: ["desk levels"],
      },
      {
        endpoint: "/api/stock/{ticker}/nope",
        method: "GET",
        description: "Net options pricing effect",
        used_by: ["desk flow"],
      },
      {
        endpoint: "/api/stock/{ticker}/volatility/stats",
        method: "GET",
        description: "IV rank / stats",
        used_by: ["desk flow"],
      },
      {
        endpoint: "/api/stock/{ticker}/flow-per-strike-intraday",
        method: "GET",
        description: "Intraday flow by strike",
        used_by: ["desk flow"],
      },
      {
        endpoint: "/api/stock/{ticker}/flow-alerts",
        method: "GET",
        description: "Ticker-specific flow alerts",
        used_by: ["SPX flow"],
      },
      {
        endpoint: "/api/stock/{ticker}/net-prem-ticks",
        method: "GET",
        description: "Net premium tick series",
        used_by: ["desk tape"],
      },
      {
        endpoint: "/api/stock/{ticker}/oi-change",
        method: "GET",
        description: "Open interest changes",
        used_by: ["desk flow"],
      },
      {
        endpoint: "/api/darkpool/{ticker}",
        method: "GET",
        description: "Dark pool prints",
        used_by: ["desk flow"],
      },
      {
        endpoint: "/api/stock/{ticker}/implied-volatility-term-structure",
        method: "GET",
        description: "IV term structure curve",
        used_by: ["desk vol"],
      },
    ],
  },
  {
    id: "finnhub",
    name: "Finnhub",
    description: "US economic calendar (macro events).",
    docs_url: "https://finnhub.io/docs/api",
    env_keys: ["FINNHUB_API_KEY", "FINNHUB_ECONOMIC_CALENDAR"],
    endpoints: [
      {
        endpoint: "/calendar/economic",
        method: "GET",
        description: "US macro calendar (premium — set FINNHUB_ECONOMIC_CALENDAR=1)",
        used_by: ["macro rail", "play gates"],
      },
      {
        endpoint: "/quote",
        method: "GET",
        description: "Quote probe (free tier health check)",
        used_by: ["admin probe"],
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    description: "LLM commentary and narrative generation.",
    docs_url: "https://docs.anthropic.com",
    env_keys: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
    endpoints: [
      {
        endpoint: "/v1/messages",
        method: "POST",
        description: "Claude chat completions",
        used_by: ["SPX commentary rail"],
      },
    ],
  },
  {
    id: "blackout_engine",
    name: "Blackout Engine",
    description: "Remote intel engine (optional overlay / proxy).",
    docs_url: null,
    env_keys: ["NEXT_PUBLIC_API_BASE", "DASHBOARD_API_SECRET"],
    endpoints: [
      {
        endpoint: "/health",
        method: "GET",
        description: "Engine liveness check",
        used_by: ["engine health API", "admin probe"],
      },
      {
        endpoint: "/spx/state",
        method: "GET",
        description: "Optional SPX intel overlay",
        used_by: ["desk (when ENGINE_INTEL_OVERLAY=1)"],
      },
      {
        endpoint: "/{proxy}",
        method: "GET",
        description: "Catch-all engine proxy routes",
        used_by: ["/api/engine/*"],
      },
    ],
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "Trade outcomes, flow cache, admin analytics persistence.",
    docs_url: null,
    env_keys: ["DATABASE_URL", "DATABASE_PUBLIC_URL"],
    endpoints: [
      {
        endpoint: "SELECT 1",
        method: "SQL",
        description: "Connection & schema ping",
        used_by: ["outcome logging", "flow ingest", "admin analytics"],
      },
    ],
  },
];
