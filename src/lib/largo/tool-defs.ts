import type { AnthropicToolDef } from "@/lib/providers/anthropic";
import {
  FLOW_TOOLS_RE,
  FUNDAMENTAL_RE,
  matchesIntent,
  NEWS_TOOLS_RE,
  NIGHTHAWK_RE,
  SCREENER_RE,
  SPX_DESK_TOOLS_RE,
  VOL_TOOLS_RE,
} from "@/lib/largo/intent-keywords";



function t(

  name: string,

  description: string,

  properties: Record<string, unknown> = {},

  required: string[] = []

): AnthropicToolDef {

  return { name, description, input_schema: { type: "object", properties, required } };

}



const T = { ticker: { type: "string", description: "e.g. NVDA, SPY, SPX, I:SPX" } };



/** Largo tool surface — Polygon/Benzinga primary (unlimited), UW fallback (rate-limited). */

export const LARGO_TOOL_DEFS: AnthropicToolDef[] = [

  t("get_quote", "Live quote from Polygon. Price, change%, day range, VWAP, volume.", T, ["ticker"]),

  t(

    "get_technicals",

    "Full MTF chart analysis from Polygon: daily/hourly/15m EMAs, RSI, MACD, ATR, S/R, weekly & monthly breakout highs/lows.",

    T,

    ["ticker"]

  ),

  t("get_peer_rs", "Relative strength vs sector ETF — 5d/10d/20d returns (Polygon bars).", T, ["ticker"]),

  t("get_seasonality", "Monthly seasonality — Polygon SPY proxy first; UW only for specific ticker.", {

    ticker: { type: "string" },

  }),

  t("get_qqq_relative_strength", "QQQ vs SPY tech leadership spread (Polygon)."),

  t("get_oi_per_strike", "OI + GEX by strike. Polygon chain first; UW fallback if empty.", {

    ...T,

    expiry: { type: "string" },

  }, ["ticker"]),

  t("get_oi_per_expiry", "OI bucketed by expiry. Polygon reference contracts first; UW fallback.", T, ["ticker"]),

  t("get_max_pain", "Max pain strike. Polygon chain first; UW fallback.", { ...T, expiry: { type: "string" } }, ["ticker"]),

  t("get_greeks", "Greeks by strike/expiry. Polygon Options Advanced first; UW fallback.", { ...T, expiry: { type: "string" } }, ["ticker"]),

  t("get_atm_chains", "ATM options contracts. Polygon chain first; UW fallback.", { ...T, expiry: { type: "string" } }, ["ticker"]),

  t("get_options_chain", "Near-the-money chain: IV, delta, OI, bid/ask. Polygon first; UW fallback.", {

    ...T,

    expiry: { type: "string" },

    option_type: { type: "string", enum: ["call", "put"] },

  }, ["ticker", "expiry", "option_type"]),

  t("get_options_volume", "Options volume. Polygon chain aggregate first; UW fallback.", T, ["ticker"]),

  t("get_options_flow", "UW ONLY — live flow alerts, 0DTE premium, strike_stacks (Repeated Hits + same-strike accumulation). No Polygon equivalent.", T, ["ticker"]),

  t("get_net_prem_ticks", "UW ONLY — tick-level net premium velocity.", T, ["ticker"]),

  t("get_nope", "UW ONLY — Net Options Pricing Effect.", T, ["ticker"]),

  t("get_flow_per_strike", "UW ONLY — intraday premium flow by strike.", T, ["ticker"]),

  t("get_flow_expiry_breakdown", "UW ONLY — premium flow by expiry.", T, ["ticker"]),

  t("get_dark_pool", "UW ONLY — dark pool institutional prints.", T, ["ticker"]),

  t("get_lit_flow", "UW ONLY — lit exchange order flow.", T, ["ticker"]),

  t("get_unusual_trades", "UW ONLY — unusual trade prints.", { ticker: { type: "string" } }),

  t("get_market_oi_change", "UW ONLY — market-wide OI changes today."),

  t("get_top_net_impact", "UW ONLY — highest net premium impact tickers."),

  t("get_iv_stats", "IV rank + OI changes. Polygon VIX rank for index proxies; UW fallback for single names.", T, ["ticker"]),

  t("get_iv_term_structure", "IV term structure. UW only.", T, ["ticker"]),

  t("get_volatility_regime", "Vol regime: Polygon VIX indices + UW IV rank if needed.", { ticker: { type: "string" } }),

  t("get_realized_vol", "UW ONLY — realized vs implied vol.", T, ["ticker"]),

  t("get_risk_reversal_skew", "UW ONLY — put/call skew history.", T, ["ticker"]),

  t("get_market_context", "Polygon indices + session status; UW market tide (exclusive)."),

  t("get_market_breadth", "Sector ETF + mega-cap breadth (Polygon)."),

  t("get_sector_flow", "Polygon sector ETF performance + UW sector tide.", {

    sector: { type: "string" },

  }),

  t("get_market_movers", "Top gainers/losers (Polygon)."),

  t("get_economic_calendar", "FOMC, CPI, NFP — static schedule + Finnhub.", { days_ahead: { type: "integer", default: 14 } }),

  t("get_etf_flow", "UW ONLY — ETF in/outflow + tide. Polygon quote for price.", { etf: { type: "string" } }),

  t("get_company_profile", "Polygon ticker details + Finnhub profile. UW fallback only.", T, ["ticker"]),

  t("get_financials", "Finnhub metrics first; UW statements fallback.", T, ["ticker"]),

  t("get_earnings", "Finnhub earnings first; UW fallback.", T, ["ticker"]),

  t("get_earnings_history", "EPS history and metrics (Finnhub).", T, ["ticker"]),

  t("get_analyst_ratings", "Analyst consensus and price targets (Finnhub).", T, ["ticker"]),

  t("get_news", "Benzinga full-text primary → Polygon sentiment → Finnhub → UW last.", {

    ticker: { type: "string" },

    channels: { type: "string" },

  }),

  t("get_web_search", "Internet search for breaking catalysts and macro context.", {

    query: { type: "string" },

  }, ["query"]),

  t("get_fda_calendar", "UW ONLY — FDA events for biotech/pharma.", T, ["ticker"]),

  t("get_ipo_calendar", "Upcoming IPOs (Finnhub)."),

  t("get_short_interest", "Polygon short interest first; UW fallback.", T, ["ticker"]),

  t("get_short_data", "Polygon SI + short volume first; UW float/FTDs fallback.", { ticker: { type: "string" } }),

  t("get_insider_flow", "Finnhub insider first; UW fallback.", T, ["ticker"]),

  t("get_congress_trades", "UW ONLY — congressional trading disclosures.", { ticker: { type: "string" } }),

  t("get_screener", "UW ONLY — stocks, short_squeeze, option_flow, dark_pool, analysts.", {

    type: { type: "string", enum: ["stocks", "short_squeeze", "contracts", "option_flow", "dark_pool", "analysts"] },

  }),

  t("get_spx_structure", "Full live SPX Sniper desk — price, GEX, flow tape, dark pool, news headlines, macro, tide (same as dashboard)."),

  t("get_spx_play", "SPX play engine state."),

  t("get_open_plays", "Open desk trades."),

  t("get_trade_history", "Closed trades from Postgres.", { ticker: { type: "string" }, days: { type: "integer" } }),

  t("get_setup_stats", "Win rates by setup from Postgres."),

  t("get_postgres_flows", "Ingested flow alerts from Postgres.", { ticker: { type: "string" }, limit: { type: "integer" } }),

  t("get_signal_log", "SPX signal log from Postgres.", { limit: { type: "integer" } }),

  t("get_lotto_state", "Today's lotto state from Postgres."),

  t("get_nighthawk_edition", "Night Hawk evening playbook — top plays, recap, market context. Same data as /nighthawk.", {
    date: { type: "string", description: "Edition date YYYY-MM-DD; defaults to latest published." },
  }),

  t("get_flow_tape", "Flow feed tape from Postgres — recent alerts + top tickers by premium.", {
    ticker: { type: "string" },
    limit: { type: "integer", default: 50 },
  }),

  t("get_platform_snapshot", "Cross-service snapshot: SPX desk + flow tape + Night Hawk edition in one call.", {
    include: {
      type: "array",
      items: { type: "string", enum: ["spx", "flows", "nighthawk", "largo"] },
      description: "Subset of services; default all three.",
    },
    flow_limit: { type: "integer", default: 50 },
    full_edition: { type: "boolean", description: "Include full Night Hawk play objects." },
  }),

  t("get_gex", "GEX/dealer map. Polygon chain GEX first; UW spot exposures fallback.", {

    ...T,

    expiry: { type: "string", description: "YYYY-MM-DD, defaults today for 0DTE" },

  }, ["ticker"]),

  t("get_greek_flow", "UW ONLY — dealer greek flow by strike/expiry.", {

    ...T,

    expiry: { type: "string" },

  }, ["ticker"]),

  t("get_option_contract", "UW ONLY — single contract flow/intraday (OCC symbol required).", {

    contract_id: { type: "string", description: "OCC symbol e.g. NVDA250117C00124000" },

  }, ["contract_id"]),

  t("get_stock_state", "UW comprehensive ticker snapshot — use get_quote + get_technicals first.", T, ["ticker"]),

  t("get_ownership", "UW ONLY — institutional ownership + insider.", T, ["ticker"]),

  t("get_institutional", "UW ONLY — 13F filings, institution activity.", {

    ticker: { type: "string" },

    institution: { type: "string", description: "e.g. Citadel, Berkshire" },

  }),

  t("get_etf_detail", "UW ETF holdings/exposure + Polygon quote.", { etf: { type: "string" } }, ["etf"]),

  t("get_market_stats", "UW ONLY — market-wide options volume, correlations, net flow.", {}),

  t("get_nbbo", "Polygon real-time NBBO quote + last trade.", T, ["ticker"]),

  t("get_uw_bars", "OHLC bars — Polygon aggs first; UW fallback only.", {

    ...T,

    candle_size: { type: "string", enum: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"], default: "1d" },

  }, ["ticker"]),

  t("get_uw_technicals", "Use get_technicals (Polygon) first. UW indicator fallback only.", {

    ...T,

    indicator: { type: "string", description: "rsi, macd, sma, ema, bbands, stoch, etc." },

    interval: { type: "string", default: "daily" },

  }, ["ticker", "indicator"]),

  t("get_earnings_market", "UW ONLY — today's premarket/afterhours earnings.", {}),

  t("get_congress_unusual", "UW ONLY — unusual congressional trades.", { ticker: { type: "string" } }),

  t("get_vix_term", "VIX term structure — Polygon VIX indices first; UW fallback.", { ticker: { type: "string" } }),

  t("get_dividends", "UW ONLY — dividends, splits (no Polygon equivalent).", T, ["ticker"]),

  t("get_global_flow", "UW ONLY — market-wide flow alerts with filters; includes strike_stacks.", {

    ticker: { type: "string" },

    min_premium: { type: "number" },

    is_call: { type: "boolean" },

    is_put: { type: "boolean" },

  }),

];

export const TOOL_GROUPS = {
  spx_desk: [
    "get_spx_structure",
    "get_spx_play",
    "get_open_plays",
    "get_flow_tape",
    "get_signal_log",
    "get_lotto_state",
    "get_setup_stats",
    "get_trade_history",
  ],
  flow_analysis: [
    "get_options_flow",
    "get_global_flow",
    "get_dark_pool",
    "get_nope",
    "get_flow_per_strike",
    "get_flow_expiry_breakdown",
    "get_net_prem_ticks",
    "get_postgres_flows",
    "get_lit_flow",
    "get_unusual_trades",
  ],
  stock_analysis: [
    "get_quote",
    "get_technicals",
    "get_gex",
    "get_options_chain",
    "get_oi_per_strike",
    "get_max_pain",
    "get_greeks",
    "get_atm_chains",
    "get_options_volume",
    "get_peer_rs",
    "get_short_interest",
    "get_nbbo",
  ],
  vol_analysis: ["get_iv_stats", "get_iv_term_structure", "get_volatility_regime", "get_vix_term", "get_market_context"],
  news_events: [
    "get_news",
    "get_web_search",
    "get_earnings",
    "get_economic_calendar",
    "get_earnings_market",
    "get_fda_calendar",
    "get_ipo_calendar",
  ],
  fundamental: [
    "get_analyst_ratings",
    "get_financials",
    "get_insider_flow",
    "get_congress_trades",
    "get_company_profile",
    "get_earnings_history",
    "get_dividends",
  ],
  platform: ["get_platform_snapshot", "get_nighthawk_edition"],
  screener: ["get_screener", "get_market_movers", "get_market_breadth", "get_sector_flow", "get_top_net_impact"],
} as const;

const CORE_TOOLS = [
  "get_market_context",
  ...TOOL_GROUPS.spx_desk,
  ...TOOL_GROUPS.stock_analysis,
  ...TOOL_GROUPS.vol_analysis,
];

export function getToolsForIntent(question: string): string[] {
  const lower = question.toLowerCase();
  const names = new Set<string>(["get_market_context"]);

  if (matchesIntent(lower, FLOW_TOOLS_RE)) {
    for (const n of [...TOOL_GROUPS.spx_desk, ...TOOL_GROUPS.flow_analysis]) names.add(n);
  }
  if (matchesIntent(lower, SPX_DESK_TOOLS_RE)) {
    for (const n of [...TOOL_GROUPS.spx_desk, ...TOOL_GROUPS.vol_analysis]) names.add(n);
  }
  if (matchesIntent(lower, VOL_TOOLS_RE)) {
    for (const n of [...TOOL_GROUPS.vol_analysis, ...TOOL_GROUPS.spx_desk]) names.add(n);
  }
  if (matchesIntent(lower, NEWS_TOOLS_RE)) {
    for (const n of [...TOOL_GROUPS.news_events, ...TOOL_GROUPS.stock_analysis]) names.add(n);
  }
  if (matchesIntent(lower, NIGHTHAWK_RE)) {
    for (const n of TOOL_GROUPS.platform) names.add(n);
  }
  if (matchesIntent(lower, SCREENER_RE)) {
    for (const n of TOOL_GROUPS.screener) names.add(n);
  }
  if (matchesIntent(lower, FUNDAMENTAL_RE)) {
    for (const n of TOOL_GROUPS.fundamental) names.add(n);
  }

  if (names.size <= 2) {
    for (const n of CORE_TOOLS) names.add(n);
  }

  return Array.from(names);
}


