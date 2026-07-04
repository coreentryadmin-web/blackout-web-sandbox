import type { AnthropicToolDef } from "@/lib/providers/anthropic";
import {
  FLOW_TOOLS_RE,
  FUNDAMENTAL_RE,
  matchesIntent,
  MY_POSITIONS_RE,
  NEWS_TOOLS_RE,
  NIGHTHAWK_RE,
  PREDICTIONS_RE,
  SCREENER_RE,
  SPX_DESK_TOOLS_RE,
  VOL_TOOLS_RE,
} from "@/lib/largo/intent-keywords";
import { KNOWN_TICKERS } from "@/lib/largo/question-intent";



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

  t("get_economic_calendar", "FOMC, CPI, NFP — curated static US macro schedule.", { days_ahead: { type: "integer", default: 14 } }),

  t("get_etf_flow", "UW ONLY — ETF in/outflow + tide. Polygon quote for price.", { etf: { type: "string" } }),

  t("get_company_profile", "Polygon ticker details; UW fallback.", T, ["ticker"]),

  t("get_financials", "UW financial statements.", T, ["ticker"]),

  t("get_earnings", "Benzinga earnings channel + UW earnings/estimates.", T, ["ticker"]),

  t("get_earnings_history", "UW earnings history and estimates.", T, ["ticker"]),

  t("get_analyst_ratings", "Benzinga analyst-ratings channel primary; UW screener fallback.", T, ["ticker"]),

  t(
    "get_news",
    "Benzinga full-text primary → Polygon sentiment → UW fallback. Optionally filter by Benzinga channel(s) to pull targeted, high-signal news.",
    {
      ticker: { type: "string", description: "e.g. NVDA, SPY. Omit for general/market-wide news." },
      channels: {
        type: "string",
        description:
          "Optional Benzinga channel filter. Space-delimited, lowercase; pass multiple by comma-separating (any-of match). Omit for general news. Available channels: 'analyst ratings', 'price target', 'upgrades', 'downgrades', 'analyst color', 'earnings', 'guidance', 'm&a', 'movers', 'after-hours center', 'insider trades', 'short sellers', 'fda', 'dividends', 'ipos', 'buybacks', 'offerings', 'top stories', 'trading ideas', 'rumors', 'exclusives'. Examples: 'fda', 'analyst ratings', 'guidance', 'm&a', 'insider trades'.",
      },
    }
  ),

  t("get_web_search", "Internet search for breaking catalysts and macro context.", {

    query: { type: "string" },

  }, ["query"]),

  t("get_fda_calendar", "UW ONLY — FDA events for biotech/pharma.", T, ["ticker"]),

  t("get_ipo_calendar", "Polygon vX IPO calendar for upcoming listings; web search fallback if none found.", {
    from: { type: "string", description: "YYYY-MM-DD start date; defaults to today" },
    to: { type: "string", description: "YYYY-MM-DD end date; defaults to 30 days out" },
  }),

  t("get_short_interest", "Polygon short interest first; UW fallback.", T, ["ticker"]),

  t("get_short_data", "Polygon SI + short volume first; UW float/FTDs fallback.", { ticker: { type: "string" } }),

  t("get_insider_flow", "UW insider transactions.", T, ["ticker"]),

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

  t(
    "get_zerodte_plays",
    "0DTE Command board — today's live 0DTE plays from the always-on scanner: lifecycle status (OPEN/HOLD/TRIM/CLOSED), entry premium and -50%/+100% plan, live P/L, graded results, plus fresh finds with BlackOut Intelligence action lines. Same data as /grid.",
    {}
  ),
  t("get_nighthawk_edition", "Night Hawk evening playbook — top plays, recap, market context. Same data as /nighthawk.", {
    date: { type: "string", description: "Edition date YYYY-MM-DD; defaults to latest published." },
  }),

  t("get_flow_tape", "HELIX tape from Postgres — recent alerts + top tickers by premium.", {
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

  t("get_gex", "GEX/dealer map. Polygon chain GEX first; UW spot exposures fallback. For SPX/I:SPX, all strike levels are SPX-denomination (thousands). Default to I:SPX (not SPY) when the user asks about index GEX or gamma walls.", {

    ...T,

    expiry: { type: "string", description: "YYYY-MM-DD, defaults today for 0DTE" },

  }, ["ticker"]),

  t("get_greek_flow", "UW ONLY — dealer greek flow by strike/expiry.", {

    ...T,

    expiry: { type: "string" },

  }, ["ticker"]),

  t("get_predictions_consensus", "UW ONLY — prediction market confidence from insiders, smart money, unusual flow, whales.", {
    ticker: { type: "string", description: "Optional filter e.g. NVDA" },
    limit: { type: "integer", default: 20 },
  }),

  t("get_group_greek_flow", "UW ONLY — basket dealer greek flow (mag7, semis, etc.).", {
    group: { type: "string", description: "Flow group e.g. mag7, semis", default: "mag7" },
    expiry: { type: "string", description: "Optional YYYY-MM-DD expiry" },
  }),

  t("get_macro_indicator", "UW ONLY — macro series (GDP, CPI, unemployment).", {
    indicator: { type: "string", enum: ["GDP", "CPI", "UNRATE"], default: "CPI" },
  }),

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

  t("get_dividends", "Polygon dividends + splits first; UW fallback.", T, ["ticker"]),

  t("search_ticker", "Full-text ticker/company name search (Polygon). Returns matches with exchange, type, market.", {
    query: { type: "string", description: "Company name or ticker prefix e.g. 'Apple' or 'NVDA'" },
    limit: { type: "integer", default: 10 },
  }, ["query"]),

  t("get_option_price_history", "Historical OHLC bars for a specific option contract (Polygon). Requires OCC symbol.", {
    contract_id: { type: "string", description: "OCC symbol e.g. AAPL250117C00200000 (O: prefix optional)" },
    multiplier: { type: "integer", default: 1 },
    timespan: { type: "string", enum: ["minute", "hour", "day"], default: "day" },
    from: { type: "string", description: "YYYY-MM-DD start date" },
    to: { type: "string", description: "YYYY-MM-DD end date" },
  }, ["contract_id"]),

  t("get_global_flow", "UW ONLY — market-wide flow alerts with filters; includes strike_stacks.", {

    ticker: { type: "string" },

    min_premium: { type: "number" },

    is_call: { type: "boolean" },

    is_put: { type: "boolean" },

  }),

  // --- Cross-tool objects the platform already computes (Largo audit wiring) ---
  t("get_spx_confluence", "SPX confluence engine — the scored desk thesis: action (BUY_CALL/BUY_PUT/HOLD/WAIT), bias, score (-100..100), grade A+..D, agreeing vs conflicting factors with weights, entry/stop/target/invalidation. Explains WHY the desk leans a direction. Pure compute on the live desk."),

  t("get_positioning", "Dealer positioning for ANY ticker — net GEX, gex king strike, gamma flip, gamma regime, net vex (vanna), max pain, negative-gamma flag, wall summary. For SPX/I:SPX queries, all strike levels returned are SPX-denomination (thousands, e.g. 5500) — never SPY (hundreds).", T, ["ticker"]),

  t("get_nighthawk_outcomes", "Night Hawk track record — realized win/loss vs target/stop over a window, plus still-pending plays. Use to cite credibility (e.g. hit-rate over 30d).", {
    window_days: { type: "integer", default: 30 },
  }),

  t("get_nighthawk_dossier", "Night Hawk per-ticker research dossier behind a pick (the full scored research). Omit ticker to list dossier tickers for the edition.", {
    date: { type: "string", description: "Edition date YYYY-MM-DD; defaults to latest." },
    ticker: { type: "string", description: "Ticker to fetch the full dossier for." },
  }),

  t("get_lotto_live", "Current live SPX lotto play (read-only record): phase, direction, strike, entry/target/invalidation, catalysts, confidence."),

  t("get_power_hour", "Current Power Hour (2:45–3:15 PM ET) play (read-only record): phase, direction, strike, levels, status."),

  t("get_my_positions",
    "Night's Watch — the signed-in user's OWN open option positions with live P&L, key Greeks, days-to-expiry, and the deterministic Hold/Trim/Sell verdict (+reasons). Use this whenever the user asks about 'my positions', 'my trades', 'my book', or 'what should I do with my <TICKER> calls/puts'. Returns only THIS user's positions.",
    { status: { type: "string", enum: ["open", "closed", "all"], description: "Default open." } }),

  t("get_catalysts", "Benzinga catalyst pipeline for a ticker — FDA, guidance, M&A, earnings, upgrades, and other event-driven catalysts from confirmed Benzinga channels.", {
    ...T,
    limit: { type: "integer", default: 8 },
  }, ["ticker"]),

  t("get_price_targets", "Benzinga analyst price target for a ticker — most recent PT, action (Maintains/Raises/Lowers), analyst firm, and prior target.", T, ["ticker"]),

  t("get_ah_movers", "Benzinga after-hours movers — tickers moving in the after-hours session with catalyst context from the Benzinga after-hours center channel.", {
    limit: { type: "integer", default: 15 },
  }),

  t(
    "get_ecosystem_context",
    "BIE cross-instrument snapshot for ONE ticker: today's 0DTE Command take (if any), the most recent Night Hawk take (published or rejected), the last 10 alert_audit_log entries, and a same-day HELIX flow summary (print count + call/put premium totals over the last 6h — reported neutrally, never as a single bullish/bearish label). Use when a question needs 'what does the rest of the desk already think about this name' rather than a single tool's isolated view — e.g. confirming whether today's 0DTE flag and last night's Night Hawk pick agree or conflict, or whether unusual options flow has been building on the name.",
    T,
    ["ticker"]
  ),

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
    "get_greek_flow",
    "get_gex",
    "get_group_greek_flow",
    // cross-tool desk objects newly surfaced to Largo
    "get_spx_confluence",
    "get_lotto_live",
    "get_power_hour",
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
    // previously orphaned (in no group → uncallable) — LARGO-9
    "get_market_oi_change",
    "get_etf_flow",
    "get_market_stats",
    "get_option_contract",
  ],
  stock_analysis: [
    "get_quote",
    "get_technicals",
    "get_gex",
    "get_greek_flow",
    "get_options_chain",
    "get_oi_per_strike",
    "get_max_pain",
    "get_greeks",
    "get_atm_chains",
    "get_options_volume",
    "get_peer_rs",
    "get_short_interest",
    "get_nbbo",
    "get_positioning",
    // previously orphaned — LARGO-9
    "get_seasonality",
    "get_qqq_relative_strength",
    "get_oi_per_expiry",
    "get_short_data",
    "get_stock_state",
    "get_uw_bars",
    "get_uw_technicals",
    "search_ticker",
    "get_option_price_history",
  ],
  vol_analysis: [
    "get_iv_stats",
    "get_iv_term_structure",
    "get_volatility_regime",
    "get_vix_term",
    "get_market_context",
    // previously orphaned — LARGO-9
    "get_realized_vol",
    "get_risk_reversal_skew",
  ],
  news_events: [
    "get_news",
    "get_web_search",
    "get_earnings",
    "get_economic_calendar",
    "get_macro_indicator",
    "get_earnings_market",
    "get_fda_calendar",
    "get_ipo_calendar",
    "get_catalysts",
    "get_price_targets",
    "get_ah_movers",
  ],
  fundamental: [
    "get_analyst_ratings",
    "get_financials",
    "get_insider_flow",
    "get_congress_trades",
    "get_congress_unusual",
    "get_institutional",
    "get_predictions_consensus",
    "get_company_profile",
    "get_earnings_history",
    "get_dividends",
    // previously orphaned — LARGO-9
    "get_ownership",
  ],
  platform: [
    "get_platform_snapshot",
    "get_zerodte_plays",
    "get_nighthawk_edition",
    // cross-tool Night Hawk objects newly surfaced to Largo
    "get_nighthawk_outcomes",
    "get_nighthawk_dossier",
    // BIE ecosystem-context query layer — one ticker's cross-instrument snapshot
    "get_ecosystem_context",
  ],
  my_book: [
    // Night's Watch — the signed-in user's OWN saved positions (per-user scoped).
    "get_my_positions",
  ],
  screener: [
    "get_screener",
    "get_market_movers",
    "get_market_breadth",
    "get_sector_flow",
    "get_top_net_impact",
    // previously orphaned — LARGO-9
    "get_etf_detail",
  ],
} as const;

const CORE_TOOLS = [
  "get_market_context",
  ...TOOL_GROUPS.spx_desk,
  ...TOOL_GROUPS.stock_analysis,
  ...TOOL_GROUPS.vol_analysis,
];

/** A known ticker or an explicit $SYMBOL means the user is asking about an
 *  instrument — always give Largo the stock + vol analysis tools so chain/greeks/
 *  technicals are never dropped by a single mismatched intent (LARGO-9). */
function mentionsTicker(question: string): boolean {
  const caps = question.toUpperCase().match(/\$?\b[A-Z]{2,5}\b/g) ?? [];
  return caps.some((c) => c.startsWith("$") || KNOWN_TICKERS.has(c.replace(/^\$/, "")));
}

export function getToolsForIntent(question: string): string[] {
  const lower = question.toLowerCase();
  const names = new Set<string>(["get_market_context"]);

  // 0DTE Command — "today's plays", the board, or anything zero-DTE flavored.
  if (/\b(0\s*dte|zero\s*dte|zerodte|command board|today'?s plays|the plays|scanner plays)\b/i.test(lower)) {
    names.add("get_zerodte_plays");
    for (const n of TOOL_GROUPS.spx_desk) names.add(n);
  }

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
  if (matchesIntent(lower, PREDICTIONS_RE)) {
    for (const n of [...TOOL_GROUPS.fundamental, "get_predictions_consensus"]) names.add(n);
  }
  // Night's Watch — "my positions / my book / what do I do with my NVDA calls".
  // Surfaces the per-user position tool plus the desk/stock context Largo needs to
  // reason about those holdings.
  if (matchesIntent(lower, MY_POSITIONS_RE)) {
    for (const n of [...TOOL_GROUPS.my_book, ...TOOL_GROUPS.stock_analysis]) names.add(n);
  }

  if (mentionsTicker(question)) {
    for (const n of [...TOOL_GROUPS.stock_analysis, ...TOOL_GROUPS.vol_analysis]) names.add(n);
  }

  if (names.size <= 2) {
    for (const n of CORE_TOOLS) names.add(n);
  }

  return Array.from(names);
}


