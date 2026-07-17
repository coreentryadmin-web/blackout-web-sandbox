/**
 * Bank 3 — deep terminal coverage (200 questions).
 * Multi-horizon, multi-ticker, session phases, options microstructure, adversarial phrasing.
 */

export const STRESS_BANK_3 = [
  // —— SPX session micro ——
  { q: "SPX opening drive vs overnight gap", intent: /spx_desk_read|spx_structure/ },
  { q: "first 30 minutes SPX dealer read", intent: "spx_desk_read" },
  { q: "midday chop on SPX — still in play", intent: "spx_desk_read" },
  { q: "final hour SPX gamma positioning", intent: /spx_desk_read|thermal_read/ },
  { q: "MOC and SPX pin into close", intent: /spx_structure|spx_desk_read/ },
  { q: "SPX vwap reclaim or reject", intent: "spx_desk_read" },
  { q: "SPX below overnight low — what changes", intent: "spx_desk_read" },
  { q: "SPX holding above yesterday high", intent: "spx_desk_read" },

  // —— 0DTE microstructure ——
  { q: "0DTE SPX charm into the last hour", intent: "thermal_read" },
  { q: "0DTE theta on ATM SPX calls", intent: /concept_read|thermal_read|spx_desk_read/ },
  { q: "SPX 0DTE skew steepening", intent: /thermal_read|vector_read/ },
  { q: "pin at round strike 7500 SPX", intent: /spx_structure|verdict/ },
  { q: "0DTE put wall defense on SPX", intent: "spx_structure", avoidDump: /SPX Live Desk read/i },

  // —— Vector horizons ——
  { q: "NVDA 0DTE gamma flip", intent: "vector_read" },
  { q: "NVDA weekly call wall", intent: "vector_read" },
  { q: "NVDA monthly max pain", intent: "vector_read" },
  { q: "TSLA 0DTE expected move", intent: "vector_read" },
  { q: "META weekly regime long or short gamma", intent: "vector_read" },
  { q: "AAPL 0DTE magnet strike", intent: "vector_read" },
  { q: "AMZN weekly put wall", intent: "vector_read" },
  { q: "GOOGL dealer positioning weekly", intent: "vector_read" },
  { q: "MSFT 0DTE king node", intent: "vector_read" },
  { q: "AMD 0DTE vs weekly flip distance", intent: /vector_read|ticker_compare/ },
  { q: "COIN 0DTE flow and walls", intent: /vector_read|helix_read/ },
  { q: "PLTR weekly technicals and gamma", intent: /vector_read|technical_read/ },

  // —— Index & ETF ——
  { q: "IWM gamma flip today", intent: "vector_read" },
  { q: "DIA dealer walls", intent: "wall_dynamics_read" },
  { q: "XLF financials flow today", intent: /helix_read|ticker_ecosystem/ },
  { q: "XLE energy vs SPX correlation", intent: /market_context|ticker_compare/ },
  { q: "TLT safe haven vs equities", intent: /market_context|ticker_compare/ },
  { q: "GLD flow and positioning", intent: /helix_read|vector_read/ },
  { q: "SMH vs NVDA relative gamma", intent: "ticker_compare" },

  // —— HELIX tape depth ——
  { q: "largest SPX call sweep today", intent: "helix_read" },
  { q: "repeat buyer on NVDA strikes", intent: "helix_read" },
  { q: "put skew buying on QQQ", intent: "helix_read" },
  { q: "0DTE premium concentration by strike SPX", intent: "helix_read" },
  { q: "unusual activity scanner top tickers", intent: /helix_read|flow_tape/ },
  { q: "lit vs options flow on SPY", intent: "helix_read" },
  { q: "net flow SPX bullish or bearish", intent: /helix_read|market_context/ },

  // —— Thermal matrix advanced ——
  { q: "SPX matrix strike 7550 GEX and VEX", intent: "thermal_read", avoidDump: /SPX Live Desk read/i },
  { q: "heatmap lens toggle — show DEX on SPX", intent: "thermal_read" },
  { q: "thermal cross validation vs UW on SPX", intent: "thermal_read" },
  { q: "QQQ thermal charm regime", intent: "thermal_read" },
  { q: "SPY matrix flip vs desk flip", intent: "thermal_read" },

  // —— Play engine & grid ——
  { q: "why did grid reject NVDA sweep", intent: "grid_rejections_read" },
  { q: "near miss on TSLA 0DTE scanner", intent: "grid_rejections_read" },
  { q: "0DTE board open positions PnL", intent: "zerodte_plays" },
  { q: "fresh finds not yet on grid", intent: "zerodte_plays" },
  { q: "SPX engine stop and target live", intent: "play_engine_read" },

  // —— Play suggest per name ——
  { q: "actionable trade on AMD 0DTE", intent: "play_suggest_read" },
  { q: "ticket for QQQ puts if bearish", intent: "play_suggest_read" },
  { q: "trade idea COIN weekly", intent: "play_suggest_read" },

  // —— Technicals multi-TF ——
  { q: "SPX daily RSI and trend", intent: "technical_read" },
  { q: "NVDA 10d return vs 20d", intent: "technical_read" },
  { q: "TSLA ATR expansion — vol regime", intent: "technical_read" },
  { q: "QQQ overbought on RSI", intent: "technical_read" },
  { q: "SPY relative strength vs IWM", intent: /technical_read|ticker_compare/ },

  // —— Wall dynamics names ——
  { q: "META walls building vs fading", intent: "wall_dynamics_read" },
  { q: "COIN gex wall ladder", intent: "wall_dynamics_read" },
  { q: "PLTR dealer wall restack", intent: "wall_dynamics_read" },

  // —— Market macro ——
  { q: "VIX term structure impact on SPX", intent: "market_context", avoidDump: /SPX Live Desk read/i },
  { q: "market tide bullish or bearish", intent: "market_context" },
  { q: "breadth thrust today", intent: "market_context" },
  { q: "risk-on vs risk-off score", intent: /market_context|verdict/ },
  { q: "credit spreads and equity tone", intent: /market_context|clarify_read/ },

  // —— Scenarios extended ——
  { q: "SPX up 50 handles — new flip level", intent: "scenario" },
  { q: "QQQ down 2% intraday gamma shift", intent: "scenario" },
  { q: "if NVDA gaps down on earnings", intent: "scenario" },
  { q: "SPX loses put wall — dealer hedge flow", intent: "scenario" },
  { q: "what if we tag max pain into close", intent: "scenario" },

  // —— Invalidation ——
  { q: "what breaks the bearish SPX case", intent: "spx_invalidation" },
  { q: "flip reclaim invalidates short gamma read", intent: /spx_invalidation|concept_read/ },

  // —— Verdict strikes ——
  { q: "is 7520 SPX put a good hedge", intent: "verdict" },
  { q: "grade TSLA 250 calls 0DTE", intent: "verdict" },
  { q: "worth buying QQQ dip here", intent: /verdict|ticker_advice/ },
  { q: "sell NVDA calls into strength", intent: /verdict|ticker_advice/ },

  // —— Ticker ecosystem ——
  { q: "what is driving SMCI today", intent: "ticker_ecosystem" },
  { q: "UNH headline and flow", intent: "ticker_ecosystem" },
  { q: "GME meme flow snapshot", intent: /ticker_ecosystem|helix_read/ },
  { q: "BABA ADR flow", intent: /ticker_ecosystem|helix_read/ },
  { q: "JPM banks tape", intent: "ticker_ecosystem" },

  // —— Compare ——
  { q: "NVDA vs TSLA which has cleaner setup", intent: "ticker_compare" },
  { q: "SPY vs QQQ gamma flip distance", intent: "ticker_compare" },
  { q: "AMD vs INTC relative positioning", intent: "ticker_compare" },

  // —— Night Hawk / Cortex ——
  { q: "Night Hawk morning check on picks", intent: "nighthawk_edition" },
  { q: "Cortex commit evidence on PLTR", intent: "cortex_read" },
  { q: "why skip small cap tonight", intent: "nighthawk_edition" },

  // —— Concepts live-adjacent ——
  { q: "negative vanna into CPI", intent: /concept_read|market_context/ },
  { q: "long gamma vs short gamma on SPX now", intent: /concept_read|spx_desk_read/ },
  { q: "what is a bead on Vector", intent: "concept_read" },

  // —— Record ——
  { q: "Night Hawk track record", intent: "record_read" },
  { q: "SPX engine historical hit rate", intent: "record_read" },
  { q: "0DTE grid win rate", intent: "record_read" },

  // —— Platform ——
  { q: "which tools are live right now", intent: "platform_read" },
  { q: "BIE data freshness snapshot", intent: "platform_read" },

  // —— Diagnostic ——
  { q: "why no flow alerts on SPX", intent: "system_diagnostic" },
  { q: "polygon options feed status", intent: "system_diagnostic" },
  { q: "redis cache warm for desk", intent: "system_diagnostic" },

  // —— Universal ——
  { q: "fetch gex heatmap for SPX", intent: "universal_lookup" },
  { q: "pull vector state for NVDA", intent: "universal_lookup" },

  // —— Compound barrage ——
  { q: "SPX flip, walls, flow, and play suggestion", intent: "compound_lookup" },
  { q: "NVDA verdict plus technicals plus HELIX", intent: "compound_lookup" },
  { q: "market regime, VIX, and SPX desk", intent: "compound_lookup" },
  { q: "thermal matrix, desk, and engine state for SPX", intent: "compound_lookup" },

  // —— Adversarial phrasing ——
  { q: "spx", intent: /spx_desk_read|spx_structure|clarify_read/ },
  { q: "nvda?", intent: /vector_read|ticker_ecosystem|clarify_read/ },
  { q: "WALLS!!! SPX!!!", intent: /wall_dynamics_read|spx_structure/ },
  { q: "gimme the sauce on 0dte", intent: /play_suggest_read|zerodte_plays|spx_desk_read/ },
  { q: "yo what's gamma doing", intent: /concept_read|spx_desk_read|thermal_read/ },
  { q: "bull or bear spx rn", intent: "spx_desk_read" },
  { q: "is it over", intent: "clarify_read" },
  { q: "tell me everything about the market", intent: /platform_read|market_context|compound_lookup/ },

  // —— Contradiction & explain ——
  { q: "you sound bullish but flow is bearish — explain", intent: "spx_desk_read", avoidDump: /SPX desk summary/i },
  { q: "why bullish and bearish labels both show", intent: "spx_desk_read", avoidDump: /SPX desk summary/i },

  // —— Brevity ——
  { q: "tl;dr SPX", intent: "spx_desk_read", avoidDump: /ALIGNMENT.*FRICTION/s },
  { q: "quick NVDA read", intent: /vector_read|ticker_ecosystem/ },
  { q: "in one sentence: best flow ticker", intent: /helix_read|flow_tape|clarify_read/ },

  // —— Options strategies (concept unless live) ——
  { q: "iron butterfly at SPX magnet", intent: /concept_read|verdict|spx_structure/ },
  { q: "jade lizard on SPY", intent: "concept_read" },
  { q: "ratio spread on NVDA — dealer impact", intent: /concept_read|scenario/ },

  // —— Sector thematic ——
  { q: "AI basket flow NVDA AMD AVGO", intent: /helix_read|compound_lookup/ },
  { q: "retail vs institutional flow today", intent: /helix_read|market_context|clarify_read/ },
  { q: "biotech XBI unusual flow", intent: "helix_read" },

  // —— More tickers ——
  { q: "SNOW earnings positioning", intent: /verdict|vector_read/ },
  { q: "CRM cloud names flow", intent: /helix_read|ticker_ecosystem/ },
  { q: "NFLX into subscriber report", intent: "verdict" },
  { q: "UBER 0DTE setup", intent: "vector_read" },
  { q: "SQ block flow", intent: "helix_read" },
  { q: "INTC turnaround flow", intent: /helix_read|ticker_ecosystem/ },
  { q: "ARM IPO gamma levels", intent: "vector_read" },
  { q: "LLY obesity trade flow", intent: /helix_read|ticker_ecosystem/ },

  // —— SPX levels numeric ——
  { q: "distance from spot to SPX gamma flip", intent: /spx_structure|spx_desk_read/ },
  { q: "how far is SPX from call wall", intent: "spx_structure", avoidDump: /SPX Live Desk read/i },
  { q: "points to max pain SPX", intent: /vector_read|spx_structure/ },

  // —— Honest limits ——
  { q: "what can't you answer from live data", intent: "clarify_read" },
  { q: "do you have my portfolio", intent: "clarify_read" },

  // —— Out of scope ——
  { q: "best restaurant in NYC", intent: null },
  { q: "solve this integral", intent: null },
  { q: "who wins the election", intent: null },

  // —— Pad to 200: institutional desk phrases ——
  { q: "dealer hedging flow if SPX breaks 7600", intent: /scenario|concept_read/ },
  { q: "short gamma acceleration zone SPX", intent: /spx_desk_read|concept_read/ },
  { q: "long gamma mean reversion band SPX", intent: /spx_desk_read|concept_read/ },
  { q: "vanna squeeze risk into FOMC", intent: /market_context|concept_read/ },
  { q: "charm tailwind on SPX calls EOD", intent: "thermal_read" },
  { q: "SPX 0DTE OI concentration at 7550", intent: /thermal_read|vector_read/ },
  { q: "hedge fund positioning proxy via flow", intent: /helix_read|market_context|clarify_read/ },
  { q: "retail 0DTE crowd on SPX", intent: /helix_read|concept_read/ },
  { q: "vol control rebalancing impact", intent: /market_context|concept_read|clarify_read/ },
  { q: "CTA trend signal vs SPX gamma", intent: /market_context|spx_desk_read|clarify_read/ },
  { q: "single name vs index divergence today", intent: "market_context" },
  { q: "SPX implied move vs realized", intent: /vector_read|spx_desk_read/ },
  { q: "QQQ NASDAQ breadth vs SPX", intent: "market_context" },
  { q: "euro close impact on US session", intent: /market_context|clarify_read/ },
  { q: "Asia session handoff SPX gap", intent: /spx_desk_read|market_context/ },
  { q: "economic calendar risk today", intent: /market_context|clarify_read/ },
  { q: "OPEX week gamma on SPX", intent: /thermal_read|spx_desk_read/ },
  { q: "triple witching positioning", intent: /concept_read|thermal_read/ },
  { q: "monthly expiry max pain SPX", intent: "vector_read" },
  { q: "weekly expiry pin SPX", intent: /vector_read|spx_structure/ },
  { q: "0DTE expiry gamma unwind", intent: /concept_read|thermal_read/ },
  { q: "SPX dealer short vs long inventory", intent: /spx_desk_read|concept_read/ },
  { q: "negative gamma chase risk into close", intent: "spx_desk_read" },
  { q: "positive gamma dampening — range day", intent: "spx_desk_read" },
  { q: "SPX slayer confluence grade meaning", intent: /concept_read|spx_desk_read/ },
  { q: "playbook shadow vs live engine", intent: /play_engine_read|concept_read/ },
  { q: "BIE vs Claude on this question", intent: /clarify_read|platform_read/ },
  { q: "Largo terminal capabilities list", intent: /platform_read|concept_read/ },
  { q: "how fresh is SPX desk data", intent: /system_diagnostic|spx_desk_read/ },
  { q: "cross check UW vs internal GEX", intent: /thermal_read|system_diagnostic/ },
  { q: "LULD halt status SPY proxy SPX", intent: /system_diagnostic|market_context/ },
  { q: "websocket options socket authenticated", intent: "system_diagnostic" },
  { q: "staging BIE path for SPX commentary", intent: /platform_read|clarify_read/ },
  { q: "vector full state cache age NVDA", intent: /system_diagnostic|vector_read/ },
  { q: "hot tickers by net premium 1h", intent: "helix_read" },
  { q: "flow brief for SPX desk", intent: /flow_tape|helix_read|spx_desk_read/ },
  { q: "gex explain in plain English SPX", intent: /concept_read|spx_desk_read/ },
  { q: "spx desk brief THESIS only", intent: "spx_desk_read" },
  { q: "alignment friction on SPX read", intent: "spx_desk_read" },
  { q: "intel edges on SPX playbook", intent: /spx_desk_read|play_engine_read/ },
  { q: "Voyage precedent similar setups SPX", intent: /spx_desk_read|concept_read/ },
  { q: "ecosystem narrative mag7", intent: /market_context|ticker_ecosystem/ },
  { q: "ticker fundamentals overlay NVDA", intent: /ticker_ecosystem|vector_read/ },
  { q: "provider health reconcile status", intent: "system_diagnostic" },
  { q: "cron uw cache refresh skipping", intent: "system_diagnostic" },
  { q: "HELIX persist high premium prints", intent: /helix_read|concept_read/ },
  { q: "net flow channel SPX SPY live", intent: /helix_read|market_context/ },
  { q: "lit trades SPY tape", intent: "helix_read" },
  { q: "option trades SPX websocket", intent: /helix_read|system_diagnostic/ },
  { q: "compare SPX thermal vs NVDA vector", intent: "ticker_compare" },
  { q: "full stack read SPX for prop desk", intent: /compound_lookup|spx_desk_read/ },
  { q: "risk manager summary SPX exposure", intent: /spx_desk_read|spx_invalidation/ },
  { q: "execution desk: where is liquidity SPX", intent: /spx_structure|concept_read|clarify_read/ },
  { q: "compliance: this is not advice — data only SPX", intent: /spx_desk_read|clarify_read/ },
];
