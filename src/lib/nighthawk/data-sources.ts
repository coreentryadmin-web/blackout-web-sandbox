/**
 * Night Hawk data-source registry — tracks which API endpoints power the evening playbook.
 */
export const NIGHTHAWK_DATA_SOURCES = {
  market: {
    wired: [
      { provider: "uw", endpoint: "/api/market/market-tide", use: "Session call/put premium bias" },
      { provider: "uw", endpoint: "/api/option-trades/flow-alerts", use: "Stock flows + hot chains" },
      { provider: "uw", endpoint: "/api/stock/{t}/flow-alerts", use: "Index/ETF flow" },
      { provider: "uw", endpoint: "/api/market/{sector}/sector-tide", use: "Sector rotation" },
      { provider: "uw", endpoint: "/api/etf/{t}/tide", use: "SPY/QQQ ETF tide" },
      { provider: "uw", endpoint: "/api/news/headlines", use: "Market + ticker news" },
      { provider: "uw", endpoint: "/api/market/top-net-impact", use: "Names driving net premium" },
      { provider: "polygon", endpoint: "/v3/snapshot/options/{underlying}", use: "GEX/max pain (primary)" },
      { provider: "uw", endpoint: "/api/market/vix-term-structure", use: "VIX term (UW fallback)" },
      { provider: "polygon", endpoint: "/v2/aggs/ticker/I:SPX|I:VIX/range/1/day", use: "SPX/VIX daily" },
      { provider: "polygon", endpoint: "/v1/market/sector-performance", use: "Sector strength/weakness" },
      { provider: "polygon", endpoint: "/v2/reference/news", use: "Market news" },
      { provider: "finnhub", endpoint: "/calendar/economic", use: "Tomorrow macro" },
      { provider: "finnhub", endpoint: "/calendar/earnings", use: "Tomorrow earnings" },
    ],
    available: [
      { provider: "uw", endpoint: "/api/market/total-options-volume", use: "Total market options vol" },
      { provider: "uw", endpoint: "/api/market/correlations", use: "Cross-asset correlations" },
      { provider: "uw", endpoint: "/api/market/oi-change", use: "Market-wide OI shifts" },
    ],
  },
  dossier: {
    wired: [
      { provider: "uw", endpoint: "/api/stock/{t}/flow-alerts", use: "Ticker flow + strike stacks" },
      { provider: "uw", endpoint: "/api/darkpool/{t}", use: "Dark pool prints" },
      { provider: "uw", endpoint: "/api/stock/{t}/oi-change", use: "OI change by strike" },
      { provider: "polygon", endpoint: "/v3/snapshot/options/{underlying}", use: "GEX/max pain (primary)" },
      { provider: "uw", endpoint: "/api/stock/{t}/spot-exposures/strike", use: "GEX/VEX ladder (UW fallback)" },
      { provider: "uw", endpoint: "/api/stock/{t}/max-pain", use: "Max pain (UW fallback)" },
      { provider: "uw", endpoint: "/api/stock/{t}/volatility/stats", use: "IV rank (UW fallback for equities)" },
      { provider: "uw", endpoint: "/api/stock/{t}/implied-volatility-term-structure", use: "IV term" },
      { provider: "uw", endpoint: "/api/stock/{t}/volatility/realized", use: "Realized vol" },
      { provider: "uw", endpoint: "/api/stock/{t}/historical-risk-reversal-skew", use: "Skew" },
      { provider: "uw", endpoint: "/api/stock/{t}/flow-per-expiry", use: "DTE flow distribution" },
      { provider: "uw", endpoint: "/api/congress/recent-trades", use: "Congressional flow" },
      { provider: "polygon", endpoint: "MTF aggs + indicators", use: "Technicals S/R gaps breakouts" },
      { provider: "finnhub", endpoint: "/stock/recommendation", use: "Analyst ratings" },
      { provider: "finnhub", endpoint: "/stock/price-target", use: "Street targets" },
      { provider: "postgres", endpoint: "flow_alerts", use: "Multi-day flow streak" },
    ],
    available: [
      { provider: "uw", endpoint: "/api/stock/{t}/greek-flow", use: "Greek flow by expiry" },
      { provider: "uw", endpoint: "/api/stock/{t}/fda-calendar", use: "FDA catalysts" },
    ],
  },
} as const;
