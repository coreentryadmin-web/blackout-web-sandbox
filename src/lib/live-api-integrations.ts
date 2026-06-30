/**
 * Central registry of live API integrations — WebSocket channels, fetch wrappers, catalog paths.
 * Used by uw-socket.ts (runtime) and analyze-api-usage.mjs / admin registry (usage detection).
 */

/** UW multiplex WebSocket channels joined in uw-socket.ts */
export const UW_WS_CHANNELS = [
  "flow_alerts",
  "market_tide",
  "off_lit_trades",
  "interval_flow",
  "trading_halts",
  "net_flow",
  "option_trades",
  "lit_trades",
  "gex_strike_expiry",
  "price",
] as const;

export type UwWsChannel = (typeof UW_WS_CHANNELS)[number];

export function uwWsChannelPath(channel: UwWsChannel): string {
  return `/api/socket/${channel}`;
}

/** REST paths wired via exported fetchUw* wrappers (function name → path template). */
export const UW_FETCH_FUNCTION_PATHS: Record<string, string> = {
  fetchUwSpotExposures: "/api/stock/{ticker}/spot-exposures",
  fetchUwSpotExposuresByStrike: "/api/stock/{ticker}/spot-exposures/strike",
  fetchUwSpotExposuresByExpiry: "/api/stock/{ticker}/spot-exposures/expiry-strike",
  fetchUwSpotExposuresExpiryStrike: "/api/stock/{ticker}/spot-exposures/expiry-strike",
  fetchUwOdteSpotExposuresByStrike: "/api/stock/{ticker}/spot-exposures/expiry-strike",
  fetchUwOdteGex: "/api/stock/{ticker}/spot-exposures/expiry-strike",
  fetchUwFlow0dte: "/api/stock/{ticker}/flow-per-strike-intraday",
  fetchUwFlowPerExpiry: "/api/stock/{ticker}/flow-per-expiry",
  fetchUwNetFlowExpiry: "/api/net-flow/expiry",
  fetchUwMarketTide: "/api/market/market-tide",
  fetchUwDarkPool: "/api/darkpool/{ticker}",
  fetchUwMaxPain: "/api/stock/{ticker}/max-pain",
  fetchUwNope: "/api/stock/{ticker}/nope",
  fetchUwIvRank: "/api/stock/{ticker}/volatility/stats",
  fetchUwTickerFlowAlerts: "/api/stock/{ticker}/flow-alerts",
  fetchUwGexLevels: "/api/stock/{ticker}/gex-levels",
  fetchUwGreekExposureExpiry: "/api/stock/{ticker}/greek-exposure/expiry",
  fetchUwGreekExposureStrike: "/api/stock/{ticker}/greek-exposure/strike",
  fetchUwNetPremTicks: "/api/stock/{ticker}/net-prem-ticks",
  fetchMarketFlowAlerts: "/api/option-trades/flow-alerts",
  fetchMarketFlowAlertRows: "/api/option-trades/flow-alerts",
  fetchUwGroupGreekFlow: "/api/group-flow/{flow_group}/greek-flow",
  fetchUwEconomyIndicator: "/api/economy/{indicator}",
  fetchUwMacroIndicators: "/api/economy/{indicator}",
  fetchUwGreekFlow: "/api/stock/{ticker}/greek-flow",
  fetchUwMarketEconomicCalendar: "/api/market/economic-calendar",
};

/** Symbols monitored for trading-halt play gates. */
export const PLAY_HALT_WATCH_SYMBOLS = ["SPX", "SPXW", "SPY", "VIX"] as const;

/** Massive LULD equity tickers that proxy halt state for index play symbols. */
export const LULD_INDEX_PROXIES: Record<string, readonly string[]> = {
  SPY: ["SPX", "SPXW"],
};

/** All UW paths considered "in use" for dashboard / probe scans. */
export function getUwLiveIntegrationPaths(): string[] {
  const ws = UW_WS_CHANNELS.map(uwWsChannelPath);
  const rest = Object.values(UW_FETCH_FUNCTION_PATHS);
  return [...ws, ...rest];
}

/** Match a documented path template against live integration paths. */
export function isUwPathLiveIntegrated(pathTemplate: string): boolean {
  const normalize = (p: string) =>
    p.replace(/\{[^}]+\}/g, "{*}").replace(/\/+$/, "");
  const target = normalize(pathTemplate);
  for (const live of getUwLiveIntegrationPaths()) {
    const n = normalize(live);
    if (n === target) return true;
    const prefix = pathTemplate.split("{")[0];
    const livePrefix = live.split("{")[0];
    if (prefix && livePrefix && prefix === livePrefix) return true;
    if (pathTemplate.startsWith("/api/socket/") && live.startsWith("/api/socket/")) {
      if (pathTemplate === live) return true;
    }
  }
  return false;
}
