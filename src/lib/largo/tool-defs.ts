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

  t(
    "get_spx_play",
    "SPX Slayer's OWN live play-engine snapshot (SPX/SPXW only) — NOT market-wide backdrop: phase (SCANNING/WATCHING/OPEN), action (SCANNING/WATCHING/BUY/HOLD/TRIM/SELL), direction, grade, score, confidence, headline/thesis, every confluence factor with its weight/detail, entry/stop/target levels, full gate state (gates.passed + humanized blocks/warnings + entry_mode + play_idea), the AI arbiter's verdict (claude), the currently open play if any (entry price, stop, target, MFE, trim status, option label/premium), the 10-item confirmation checklist, MTF/RSI/EMA technicals, the option ticket, watch-state (armed-but-not-yet-open, with promote_ready), adaptive-gate telemetry (cold/promote win rates, score boosts), lotto and power-hour sub-plays, session_phase, and signal_committed (true only once a play is actually committed to the DB this cycle — a BUY action alone does NOT mean a position is live; wait for signal_committed before treating it as opened). Use for 'what phase/setup/bias is SPX Slayer in right now,' 'why did the play get rejected/vetoed,' 'what gates or confluence factors are active,' or any question about THIS engine's own current or most recently closed play — for market-wide conditions that aren't specific to this play engine (regime, backdrop, is-this-a-good-environment), use get_market_regime instead. get_ecosystem_context returns this exact object as spx_full_state when ticker is SPX/SPXW — prefer that single call instead of this one if the turn also needs Night Hawk's take, HELIX flow, or anomaly context for the same ticker."
  ),

  t("get_open_plays", "Open desk trades."),

  t("get_trade_history", "Closed trades from Postgres.", { ticker: { type: "string" }, days: { type: "integer" } }),

  t("get_setup_stats", "Win rates by setup from Postgres."),

  t("get_postgres_flows", "Ingested flow alerts from Postgres.", { ticker: { type: "string" }, limit: { type: "integer" } }),

  t("get_signal_log", "SPX signal log from Postgres.", { limit: { type: "integer" } }),

  t(
    "get_spx_engine_snapshots",
    "Retrospective log of the SPX play engine's REJECTED/scanning history — answers 'why was the last signal rejected' or 'what was the engine doing at time Y', which get_signal_log CANNOT answer: get_signal_log's spx_signal_log table only ever records a COMMITTED BUY/SELL/TRIM signal, so a gate-blocked entry, a Claude veto, a WATCHING/near-miss setup, or a plain no-setup SCANNING tick leaves zero trace there — the evaluation happened, then vanished once the next poll tick overwrote it in memory. This tool reads spx_engine_snapshots instead: one row per DISTINCT phase/action/direction/gates state the engine has passed through (throttled to state transitions only, not one row per poll tick, so consecutive identical ticks collapse into a single row spanning that whole period) — phase (SCANNING/WATCHING/OPEN), action, direction, score, the exact gates.blocks list that kept a would-be entry from firing (e.g. 'MTF conflict', 'below full min score', 'Claude veto: ...'), a thesis/explanation string, and the engine's as_of timestamp for that state. Use for 'why didn't SPX Slayer take a trade earlier today', 'what was blocking entry at 10:15', or 'when did the engine's bias flip from bullish to bearish watching' — questions about the engine's rejected/scanning history. For the committed trade history itself, use get_signal_log (recent fired signals) or get_trade_history (closed, graded trades) instead.",
    { limit: { type: "integer" } }
  ),

  t("get_lotto_state", "Today's lotto state from Postgres."),

  t(
    "get_zerodte_plays",
    "0DTE Command's OWN live scanner board (the default tab at /grid, formerly branded 'BlackOut Grid') — a DIFFERENT, MULTI-TICKER engine from SPX Slayer: an always-on scanner that hunts the broader tape all session for brand-new 0DTE setups across many tickers (index products like SPY/QQQ/NDX are eligible alongside single names), never SPX/SPXW's own single-instrument play engine. Returns: `plays` — today's ledger of setups the scanner has already flagged, each with lifecycle `status` (OPEN/HOLD/TRIM/CLOSED), `direction`, `strike`, `entry_premium`, `last_mark`, `live_pnl_pct`, `peak_score`, the current BlackOut Intelligence `action`/`intel` reasoning line, and (once closed) a `graded` outcome/pnl_pct; `fresh_finds` — the top 5 setups the scanner just surfaced this cycle that are NOT yet on the ledger (ticker/direction/strike/score/gross_premium/aggression/plan/intel); `excluded_covered_elsewhere` — tickers deliberately withheld from fresh_finds because last night's Night Hawk edition already covers them (a name members already have is a repeat, not a find, so it won't double-count here); and `rules`, the 0DTE discipline every play is managed to (no new entries after 15:00 ET, -50%/+100% stop/trim plan, hard exit by 15:30 ET). IMPORTANT — do not conflate this with SPX Slayer: this tool has no visibility into and never reflects SPX Slayer's own phase/gates/confluence/score for its current or most recent play. For SPX/SPXW's own single-instrument play-engine state, use get_spx_play (or get_spx_structure for the full desk view) instead — only reach for this tool when the question is actually about the multi-ticker 0DTE Command scanner/board itself. This tool ONLY shows setups that already cleared every gate — for a candidate that DIDN'T make the board, use get_zerodte_rejections instead.",
    {}
  ),
  t(
    "get_zerodte_rejections",
    "0DTE Command's near-miss/gate-rejection log — answers 'why didn't ticker X make the Grid board' or 'what has the scanner been rejecting today', which get_zerodte_plays structurally CANNOT answer: that tool only ever shows candidates that already cleared every one of the scanner's 4 evidence gates (gross premium ≥ $750k, at-the-ask aggression share ≥ 30%, side dominance ≥ 65%, and not a deep-ITM stock-replacement strike) — a candidate that failed even ONE of those checks is invisible there and left no trace anywhere until this tool existed. Reads zerodte_scan_rejections: one row per ticker per DISTINCT rejection state (throttled to state transitions, not one row per scan cycle), naming exactly which `gate_failed` (min_gross/min_aggr_share/min_dominance/max_itm_pct/no_dominant_strike) stopped the candidate, the live `threshold` it was measured against, and whichever of gross_premium/aggression/side_dominance/otm_pct had actually been computed before the scan short-circuited past it — later-gate metrics are `null`, never guessed, when an earlier gate already rejected the ticker (e.g. a min_gross rejection never learns a direction or aggression share, because the live scan never computes those for it either). Pass `ticker` to scope to one name's rejection history, or omit for the most recent rejections across every candidate. IMPORTANT — this is 0DTE Command's OWN multi-ticker scanner (src/lib/zerodte/board.ts, the exact same engine get_zerodte_plays reads), a COMPLETELY DIFFERENT product from SPX Slayer: for SPX/SPXW's own single-instrument engine's rejected/scanning history, use get_spx_engine_snapshots instead — do not conflate the two just because both are 0DTE-flavored.",
    { ticker: { type: "string" }, limit: { type: "integer" } }
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

  t(
    "get_gex_regime_events",
    "BlackOut Thermal's durable log of GEX regime/flip/wall-crossing events — answers 'when did SPY's gamma flip last cross', 'how many times has NVDA's call wall broken today', or 'has the gamma regime flipped this session', which get_positioning/get_gex structurally CANNOT answer: those two only ever return the CURRENT snapshot, with no memory of what changed earlier in the session. Reads gex_regime_events: one row per DISTINCT (ticker, event type + direction) transition (throttled to real state changes, not one row per matrix poll), each carrying event_type (flip_crossed / wall_broken / regime_flipped / net_gex_sign_flipped), severity (warn for destabilizing crosses, info otherwise), the human message, the level crossed (flip/wall strike) when applicable, direction, and the natural from_value/to_value numeric pair for that event type (spot before/after the crossed level for flip_crossed/wall_broken; the gamma-flip level at each end for regime_flipped; net GEX dollars before/after for net_gex_sign_flipped) — null when a type has no single natural pair, never fabricated. Pass `ticker` to scope to one name's transition history, or omit for the most recent transitions across every ticker BlackOut Thermal has computed a fresh matrix for. IMPORTANT — this is a DIFFERENT question from get_positioning/get_gex (current state) and from /api/cron/gex-alerts' live push notifications (which only ever fire for SPY/SPX/QQQ and only for a subset of these same event types) — this tool's history spans EVERY ticker Thermal has touched today and every event type, independent of whether a push was ever sent.",
    { ticker: { type: "string" }, limit: { type: "integer" } }
  ),

  t("get_nighthawk_outcomes", "Night Hawk track record — realized win/loss vs target/stop over a window, plus still-pending plays. Use to cite credibility (e.g. hit-rate over 30d).", {
    window_days: { type: "integer", default: 30 },
  }),

  // Computed server-side (not left to the model) specifically because a comparison
  // between two products is a DERIVED number — see run-tool.ts's dispatch case for
  // why that matters for grounding correctness.
  t(
    "get_spx_vs_nighthawk_comparison",
    "Head-to-head SPX Slayer (0DTE Command intraday plays) vs Night Hawk (evening swing picks) performance over the SAME rolling window: each product's own win rate + signal volume, PLUS a pre-computed win-rate delta and signal-count delta — computed once, server-side, so the model never subtracts two other tools' numbers itself. `days` is a rolling day-count window (not a calendar week), applied identically to both products — same honest-approximation framing as get_trade_history's `days` and get_nighthawk_outcomes' `window_days`. Use this instead of calling get_setup_stats and get_nighthawk_outcomes separately whenever a question directly compares the two products (e.g. 'how's SPX Slayer doing vs Night Hawk this week', 'which is hotter right now').",
    {
      days: {
        type: "integer",
        default: 7,
        description: "Rolling day window applied identically to both products (not a calendar week).",
      },
    }
  ),

  t("get_nighthawk_dossier", "Night Hawk per-ticker research dossier behind a pick (the full scored research) — flow/tech/positioning/news/smart-money/fundamental/short-interest/catalyst sub-scores, fundamental_block, trading_halt. Omit ticker to list dossier tickers for the edition. Works both WHILE tonight's hunt is still building AND the morning after it publishes: live staging is cleared once an edition publishes, so this transparently falls back to the durable nighthawk_scoring_history archive once that happens (response includes `archived: true` when the answer came from the archive rather than live staging) — always the right tool for 'why was ticker X scored/excluded', regardless of when it's asked.", {
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
    "BIE cross-instrument snapshot for ONE ticker: today's 0DTE Command take (if any), the most recent PUBLISHED Night Hawk take (a rejected play never appears here — check recent_audit_entries for an 'nighthawk_rejected' alert_type instead), the last 10 alert_audit_log entries, a same-day HELIX flow summary (print count + call/put premium totals over the last 6h — reported neutrally, never as a single bullish/bearish label), flow_full_state (HELIX's ENTIRE flow-tape snapshot for this ticker — the exact same object get_flow_tape returns: count, total_premium, top_tickers, and the full recent print list, EACH print additionally carrying gex_proximity ('at_gamma_flip'/'at_call_wall'/'at_put_wall'/'near_call_wall'/'near_put_wall') from the same GEX enrichment the live /flows member page applies; null when there's no flow for this ticker in-window — use this instead of a separate get_flow_tape call when you already need this ticker's other ecosystem context too, and prefer it over recent_flow whenever you need the actual prints/strikes/GEX proximity rather than just the premium totals), any pattern-detected flow anomalies in the last 24h (coordinated sweeps, premium spikes, put surges, concentration), spx_play (SPX/SPXW only — SPX Slayer's own current open play and most recently closed play, null for every other ticker), spx_full_state (SPX/SPXW only — SPX Slayer's ENTIRE live play-engine snapshot, the exact same object get_spx_play returns: phase, every confluence factor with its weight/detail, full gate pass/fail state, the 10-item confirmation checklist, MTF/RSI/EMA technicals, adaptive-gate telemetry, watch state, the AI arbiter's verdict, the option ticket; null for every other ticker — use this instead of a separate get_spx_play call when you already need this ticker's other ecosystem context too), gex_positioning (BlackOut Thermal's canonical dealer positioning for this ticker — the exact same object get_positioning's underlying getGexPositioning() call reads: spot, gamma flip, call_wall/put_wall, max_pain, gex_king_strike, net GEX/VEX/DEX/CHARM each with a posture + one-line regime read, nearest_wall (closer of the two walls, with signed point distance), distance_to_flip_pct, and an optional UW cross-validation check on the primary levels; runs for EVERY ticker, not gated to SPX/SPXW, since GEX positioning is not a single-instrument product; null when the shared GEX matrix is cold for this ticker — use this instead of a separate get_positioning call when you already need this ticker's other ecosystem context too, and prefer get_positioning standalone only when you don't need anything else here; it returns a lighter reshaped subset missing DEX/CHARM/nearest_wall/distance_to_flip_pct. For the raw per-strike/per-expiry GEX chain itself rather than this summarized positioning read, use get_gex instead), and flow_feed_fresh (is the live flow pipeline actually up right now). IMPORTANT: if flow_feed_fresh is false, a null/empty recent_flow, flow_full_state, or recent_anomalies means 'we can't currently see,' NOT 'genuinely quiet' — say so rather than reporting silence as a finding. Use when a question needs 'what does the rest of the desk already think about this name' rather than a single tool's isolated view — e.g. confirming whether today's 0DTE flag and last night's Night Hawk pick agree or conflict, whether unusual options flow has been building on the name (including exactly which strikes/prints and whether they sit near a GEX wall), whether dealer gamma positioning favors a squeeze or pin, or (for SPX/SPXW) whether SPX Slayer already has a live play on and its full reasoning behind it.",
    T,
    ["ticker"]
  ),

  t(
    "get_hot_tickers",
    "Leaderboard of single-name tickers with the most options-flow premium over the last 6h (print count + total premium each). Index/ETF and leveraged-ETP names are excluded so SPY/QQQ don't just occupy every slot. Use for open-ended 'what's hot / what's moving / any unusual flow today' questions that don't name a specific ticker — for a question ABOUT one ticker, use get_ecosystem_context or get_flow_tape instead."
  ),

  t(
    "get_market_regime",
    "Market-wide backdrop, not ticker-specific and NOT SPX Slayer's own play-engine state: composite regime (BREAKOUT_BULL/BREAKDOWN_BEAR/RANGE_BOUND/MIXED), GEX regime, flow regime, the suggested playbook, net GEX, above/below VWAP, IV percentile, count of critical flow anomalies in the last hour (+ which tickers), and the premarket brief's call/put walls. This is the SAME data Night Hawk's own scoring already reads internally (src/lib/nighthawk/platform-intel-snapshot.ts) — use for 'what's the market regime / what's the backdrop / is this a good environment for X' questions. Does NOT cover SPX Slayer's own phase/gates/score/confluence for its current or most recent play — for that, use get_spx_play (or get_ecosystem_context's spx_full_state field). This anomaly count only ever includes anomalies that actually FIRED — for a candidate that didn't clear the anomaly threshold (or fired but got dedup-suppressed), use get_flow_anomaly_near_misses instead."
  ),

  t(
    "get_flow_anomaly_near_misses",
    "HELIX's near-miss/rejection log for its market-wide flow-anomaly detector (src/app/api/cron/market-regime-detector's 5-min RTH cron) — answers 'why didn't ticker X get flagged as an anomaly' or 'what has HELIX's anomaly scan been passing over today', which NEITHER of the two existing anomaly-reading surfaces can answer: get_ecosystem_context's `recent_anomalies` field and get_market_regime's critical-anomaly count BOTH only ever read the flow_anomalies table, which the live detector writes to ONLY once a candidate clears a hard threshold — a $2M+ single option print (LARGE_PREMIUM_PRINT) or a 10:1+ call/put premium skew on $500k+ total volume (DIRECTIONAL_FLOW_SKEW). A candidate that fell short — a $1.8M print, an 8:1 skew — is invisible in both of those and left no trace anywhere until this tool existed. Reads flow_anomaly_near_misses: one row per (ticker, anomaly_type) pair per DISTINCT near-miss state (throttled to state transitions, not one row per cron tick), each row naming the `anomaly_type`, the `reason` it never reached flow_anomalies — 'BELOW_THRESHOLD' (the metric itself never cleared the hard threshold; only genuinely close calls are captured, at least half-way to the real threshold, not every sub-threshold value) vs. 'DEDUP_SUPPRESSED' (the candidate DID clear its threshold this tick, but a matching anomaly was already logged for the same ticker+type within the last 15 minutes, so the write was skipped — a structurally different, later-pipeline-stage reason, never conflated with BELOW_THRESHOLD) — the live `metric_value` and `threshold` it was measured against (a dollar amount for LARGE_PREMIUM_PRINT, a ratio for DIRECTIONAL_FLOW_SKEW — do not confuse with `premium`, which is always a dollar total), `direction`, and (for DEDUP_SUPPRESSED only — a BELOW_THRESHOLD candidate never reaches the point where the live detector assigns one) `severity`. Pass `ticker` to scope to one name's near-miss history, or omit for the most recent near-misses across every candidate. IMPORTANT — this is a DIFFERENT question from get_ecosystem_context's `recent_anomalies` and get_market_regime's anomaly count (both committed-only, i.e. anomalies that DID fire) and from get_zerodte_rejections (0DTE Command's OWN separate multi-ticker scanner, a completely different engine and threshold set) — only reach for this tool when the question is specifically about why HELIX's flow-anomaly detector did NOT flag something.",
    { ticker: { type: "string" }, limit: { type: "integer" } }
  ),

  t(
    "get_confluence_outcomes",
    "Platform-wide, not ticker-specific: does agreeing across instruments/factors actually correlate with a different hit rate? Two sections, both evidence-gated (a bucket under 10 samples is flagged insufficient_sample — treat its numbers as noise, not signal, and say so if asked). `zerodte_nighthawk_echo`: over the last 60 days of GRADED 0DTE Command flags, buckets agree / disagree / no_echo (no prior Night Hawk take at all) by hit rate % and average move %. `spx_slayer_shadow_factors`: SPX Slayer's shadow-mode confluence factors (risk-reversal skew, realized-vs-implied vol, flow anomalies, mega-cap catalysts, ecosystem cross-instrument agreement, macro-prediction consensus — see spx_confluence_shadow_observations) correlated against SPX Slayer's own real graded trade outcomes, bucketed per factor_name by agree / disagree / neutral with win rate % and average P&L in points; a factor_name with no bucket yet reaching 10 samples has not earned a live-scoring opinion. Use for 'does it help when the instruments agree / is confluence real / how reliable is X / is [shadow factor] worth promoting' meta-questions about the platform's own track record, not for a single play's own grade (use get_zerodte_plays, get_nighthawk_outcomes, or get_spx_play for that)."
  ),

  t(
    "get_similar_precedents",
    "Semantic search over the platform's own history of RESOLVED alerts (0DTE Command + Night Hawk, published and rejected) — 'has a setup like this happened before, and what happened.' Pass a short natural-language description of the CURRENT situation (e.g. 'NVDA 0DTE long setup, high conviction, aggression spike') as `query`; returns the most similar past alerts with their outcome, ranked by similarity. This is pattern-matching on the platform's own track record, not a live signal — a returned precedent is historical color for a member's question, never a reason to change a live gate or score. Empty results mean either no similar precedent exists yet or the corpus hasn't accumulated enough graded history — say so rather than implying 'never happened before.'",
    { query: { type: "string", description: "Natural-language description of the current setup to find precedents for." } },
    ["query"]
  ),

];

// The BIE-authored subset of Largo's tool surface — single source of truth so
// TOOL_GROUPS.platform below and knowledge.ts's generated capabilities doc
// (ingestBieKnowledge) both read the same list. Add a new BIE tool here once;
// both consumers pick it up automatically instead of needing a second edit.
export const BIE_TOOL_NAMES = [
  "get_ecosystem_context",
  "get_hot_tickers",
  "get_market_regime",
  "get_confluence_outcomes",
  "get_similar_precedents",
];

export const TOOL_GROUPS = {
  spx_desk: [
    "get_spx_structure",
    "get_spx_play",
    "get_open_plays",
    "get_flow_tape",
    "get_signal_log",
    "get_spx_engine_snapshots",
    "get_lotto_state",
    "get_setup_stats",
    "get_trade_history",
    "get_greek_flow",
    "get_gex",
    "get_gex_regime_events",
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
    "get_gex_regime_events",
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
    "get_zerodte_rejections",
    "get_nighthawk_edition",
    // cross-tool Night Hawk objects newly surfaced to Largo
    "get_nighthawk_outcomes",
    "get_nighthawk_dossier",
    // Cross-product comparison — routed here (not spx_desk) so it's reachable
    // whenever NIGHTHAWK_RE fires, same as the two tools above it.
    "get_spx_vs_nighthawk_comparison",
    // The BIE-authored tools (ecosystem-context, hot-tickers, market-regime,
    // confluence-outcomes) — see BIE_TOOL_NAMES above for the canonical list.
    ...BIE_TOOL_NAMES,
    // HELIX flow-anomaly near-miss/rejection log (task #131) — reads the same
    // market-regime-detector cron's output as get_market_regime above, so it
    // lives right alongside it here rather than in BIE_TOOL_NAMES (which is
    // reserved for the BIE-authored cross-instrument snapshot family).
    "get_flow_anomaly_near_misses",
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

// Task #112 — the cohort-membership test for "did this Largo turn touch SPX
// Slayer's OWN live-engine state" (BIE's self-eval loop, calibration.ts). This is
// deliberately a NARROWER list than TOOL_GROUPS.spx_desk above: spx_desk is a
// *routing* bundle (every tool Largo should have on hand when a question smells
// SPX-flavored, per getToolsForIntent below), so it also carries generic,
// ticker-agnostic market-data tools that are bundled in purely for convenience —
// get_flow_tape, get_greek_flow, get_gex, get_group_greek_flow all take a
// `ticker`/`group` input and hit the same generic UW/Polygon providers
// run-tool.ts uses for ANY ticker (get_greek_flow/get_gex are even shared with
// TOOL_GROUPS.stock_analysis). A turn that only called those tells you nothing
// about SPX-Slayer-engine-state answer quality specifically — it could just as
// easily have been an AAPL flow question. This list keeps only the tools whose
// run-tool.ts implementation reads the engine's own state — `marketPlatform.spx.*`
// (getSpxDeskSummary/getSpxPlayState/getSpxOpenPlay/getSpxSignalLog/
// getSpxLottoState/getSpxSetupStats/getSpxTradeHistory) or pure compute over the
// already-cached live desk / the engine's own lotto/power-hour evaluator output
// (get_spx_confluence, get_lotto_live, get_power_hour) — verified against
// run-tool.ts's case statements, not guessed from naming. Deliberately excludes
// get_ecosystem_context (in BIE_TOOL_NAMES/TOOL_GROUPS.platform): it's a
// cross-product tool callable for ANY ticker, and bie_interactions.tools_used only
// records tool NAMES, never call inputs — there is no way to tell from a
// bie_interactions row alone whether a given get_ecosystem_context call was
// scoped to SPX or to some other ticker, so including it would silently admit
// unrelated cross-product lookups into an "SPX engine state" cohort. Kept as an
// explicit literal list (not derived from TOOL_GROUPS.spx_desk) so this cohort
// tracks "did Largo read the engine's own state" and does not silently
// widen/narrow if spx_desk's bundle composition changes for unrelated
// (system-prompt-routing) reasons — see tool-defs.test.ts for the assertion that
// keeps this list a verified subset of spx_desk.
export const SPX_ENGINE_TOOL_NAMES = [
  "get_spx_structure",
  "get_spx_play",
  "get_open_plays",
  "get_signal_log",
  // get_spx_engine_snapshots (task #108, merged alongside this cohort list) reads the
  // exact same engine-state stream as get_signal_log — the throttled, gate-rejection-
  // inclusive snapshot log rather than the committed-only one — so it belongs in this
  // cohort for the same reason get_signal_log does.
  "get_spx_engine_snapshots",
  "get_lotto_state",
  "get_lotto_live",
  "get_setup_stats",
  "get_trade_history",
  "get_spx_confluence",
  "get_power_hour",
];

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
    // Near-miss/rejection log (task #147) — added alongside get_zerodte_plays on the
    // same bare-token match so a "why didn't X make the 0dte board" question always
    // has both tools available, not just the committed-plays one.
    names.add("get_zerodte_rejections");
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


