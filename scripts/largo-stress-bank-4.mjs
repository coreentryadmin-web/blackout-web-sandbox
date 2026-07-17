/**
 * Bank 4 — terminal power-user catalog (~121 questions).
 * Largo meta, multi-leg structures, session edges, extended ticker coverage.
 */

export const STRESS_BANK_4_RAW = [
  // —— Largo terminal meta ——
  { q: "what can Largo answer", intent: /platform_read|clarify_read|concept_read/ },
  { q: "list Largo capabilities", intent: /platform_read|concept_read/ },
  { q: "how do I ask for SPX desk read in Largo", intent: /concept_read|clarify_read/ },
  { q: "difference between Vector and Thermal in Largo", intent: "concept_read" },
  { q: "when does Largo use Claude vs BIE", intent: /concept_read|platform_read|clarify_read/ },

  // —— SPX pro depth ——
  { q: "SPX 0DTE dealer positioning summary", intent: /spx_desk_read|thermal_read/ },
  { q: "SPX confluence grade and direction", intent: "spx_desk_read" },
  { q: "SPX playbook shadow panel state", intent: /play_engine_read|spx_desk_read/ },
  { q: "SPX live chain play tab status", intent: /play_engine_read|spx_desk_read/ },
  { q: "SPX trade alerts pipeline", intent: /play_engine_read|helix_read/ },
  { q: "SPX kanban open plays", intent: /zerodte_plays|play_engine_read/ },
  { q: "SPX matrix spot scroll anchor", intent: /thermal_read|concept_read/ },
  { q: "SPX quad desk layout data feeds", intent: /platform_read|spx_desk_read/ },

  // —— Flow micro ——
  { q: "aggregated premium SPX last 15 minutes", intent: /helix_read|flow_tape/ },
  { q: "call vs put premium ratio SPX", intent: /helix_read|spx_desk_read/ },
  { q: "multi-leg print on SPX", intent: /helix_read|concept_read/ },
  { q: "intermarket sweep SPY triggering SPX read", intent: /helix_read|spx_desk_read/ },
  { q: "0DTE notional leader today", intent: /helix_read|flow_tape/ },

  // —— Vector extended tickers ——
  { q: "ASTS weekly gamma walls", intent: "vector_read" },
  { q: "RIVN 0DTE dealer regime", intent: "vector_read" },
  { q: "SOFI flow and flip", intent: /vector_read|helix_read/ },
  { q: "HOOD meme positioning", intent: /vector_read|ticker_ecosystem/ },
  { q: "MSTR bitcoin proxy gamma", intent: "vector_read" },
  { q: "CVNA squeeze positioning", intent: /vector_read|ticker_ecosystem/ },
  { q: "SHOP earnings week walls", intent: "vector_read" },
  { q: "ORCL cloud sector read", intent: /vector_read|ticker_ecosystem/ },
  { q: "PANW cybersecurity flow", intent: /helix_read|ticker_ecosystem/ },
  { q: "CRWD unusual options activity", intent: "helix_read" },

  // —— Scenarios advanced ——
  { q: "if SPX rips 1% into close what happens to charm", intent: "scenario" },
  { q: "what if QQQ loses weekly put wall", intent: "scenario" },
  { q: "hypothetical SPX at 7400 — gamma regime", intent: "scenario" },
  { q: "assume NVDA beats — flip level shift", intent: "scenario" },
  { q: "imagine VIX at 25 — SPX read impact", intent: /scenario|market_context/ },

  // —— Invalidation extended ——
  { q: "kill switch for SPX long thesis", intent: "spx_invalidation" },
  { q: "what reclaims bullish SPX structure", intent: "spx_invalidation" },
  { q: "stop run level on QQQ", intent: /spx_invalidation|vector_read/ },

  // —— Verdict extended ——
  { q: "verdict on SPX 7580 calls 0DTE", intent: "verdict" },
  { q: "is NVDA 900 call worth it this week", intent: "verdict" },
  { q: "bottom line on TSLA for today", intent: /verdict|ticker_ecosystem/ },
  { q: "final call on IWM vs SPY", intent: /verdict|ticker_compare/ },

  // —— Technicals extended ——
  { q: "SPX daily chart RSI divergence", intent: "technical_read" },
  { q: "NVDA weekly EMA200 test", intent: "technical_read" },
  { q: "QQQ MACD and trend", intent: /technical_read|concept_read/ },
  { q: "SPY 20-day range position", intent: "technical_read" },

  // —— Wall dynamics extended ——
  { q: "QQQ walls building at resistance", intent: "wall_dynamics_read" },
  { q: "IWM put wall integrity", intent: "wall_dynamics_read" },
  { q: "SPX call wall restack after break", intent: "wall_dynamics_read" },

  // —— Play suggest extended ——
  { q: "ticket for SPX if bullish into close", intent: "play_suggest_read" },
  { q: "best 0DTE structure on QQQ", intent: "play_suggest_read" },
  { q: "actionable fade at SPX call wall", intent: /play_suggest_read|verdict/ },

  // —— Night Hawk / Cortex extended ——
  { q: "Night Hawk pulled tickers tonight", intent: "nighthawk_edition" },
  { q: "morning confirmation on Night Hawk picks", intent: "nighthawk_edition" },
  { q: "Cortex skip reason for small caps", intent: "cortex_read" },

  // —— Record / platform ——
  { q: "published track record SPX slayer", intent: "record_read" },
  { q: "HELIX alert outcome stats", intent: "record_read" },
  { q: "platform health all tools", intent: /platform_read|system_diagnostic/ },

  // —— Diagnostic extended ——
  { q: "why HELIX tape empty", intent: "system_diagnostic" },
  { q: "desk bootstrap cold start", intent: "system_diagnostic" },
  { q: "cache miss on gex heatmap", intent: "system_diagnostic" },

  // —— Compound power user ——
  { q: "Give me SPX flip, HELIX top print, and play engine state", intent: "compound_lookup" },
  { q: "NVDA walls, flow, verdict, and technicals together", intent: "compound_lookup" },
  { q: "Market regime plus VIX plus SPX invalidation", intent: "compound_lookup" },

  // —— Adversarial / typos ——
  { q: "spx flip?", intent: /spx_structure|spx_desk_read/ },
  { q: "nvdia setup", intent: /vector_read|clarify_read/ },
  { q: "WALL DYNAMICS spx", intent: "wall_dynamics_read" },
  { q: "TECHNICALS qqq", intent: "technical_read" },
  { q: "PLAY SUGGESTION tsla", intent: "play_suggest_read" },

  // —— Concepts advanced ——
  { q: "what is dealer hedging", intent: "concept_read" },
  { q: "define pin risk 0DTE", intent: "concept_read" },
  { q: "explain confluence grade A vs C", intent: "concept_read" },
  { q: "what is BIE on BlackOut", intent: "concept_read" },

  // —— Universal ——
  { q: "lookup spx bootstrap payload", intent: "universal_lookup" },
  { q: "show admin launch status tools", intent: /universal_lookup|platform_read/ },

  // —— Out of scope ——
  { q: "book me a flight", intent: null },
  { q: "translate to French", intent: null },

  // —— Pad: institutional session + sectors ——
  { q: "Europe close tone into US open SPX", intent: /market_context|spx_desk_read/ },
  { q: "Asia risk-off and SPX gap", intent: /market_context|spx_desk_read/ },
  { q: "energy complex XLE vs SPX", intent: "ticker_compare" },
  { q: "healthcare XLV flow today", intent: /helix_read|ticker_ecosystem/ },
  { q: "utilities XLU defensive bid", intent: /helix_read|market_context/ },
  { q: "reits IYR rate sensitivity", intent: /ticker_ecosystem|concept_read/ },
  { q: "homebuilders XHB vs SPX", intent: "ticker_compare" },
  { q: "regional banks KRE stress", intent: /ticker_ecosystem|helix_read/ },
  { q: "software IGV vs NVDA", intent: "ticker_compare" },
  { q: "cyber basket vs QQQ", intent: "ticker_compare" },
  { q: "EV basket TSLA RIVN flow", intent: /helix_read|compound_lookup/ },
  { q: "crypto proxies COIN MSTR alignment", intent: "ticker_compare" },
  { q: "gold miners GDX vs GLD", intent: "ticker_compare" },
  { q: "silver SLV industrial bid", intent: /ticker_ecosystem|helix_read/ },
  { q: "copper CPER macro read", intent: /market_context|clarify_read/ },
  { q: "yen carry unwind equity impact", intent: /market_context|clarify_read/ },
  { q: "dollar DXY risk appetite", intent: /market_context|clarify_read/ },
  { q: "crude oil CL spillover to SPX", intent: /market_context|spx_desk_read/ },
  { q: "natural gas UNG volatility", intent: /market_context|clarify_read/ },
  { q: "volatility complex VIX VVIX", intent: /market_context|concept_read/ },
  { q: "skew index SKEW interpretation", intent: /concept_read|market_context/ },
  { q: "0DTE volume share of SPX options", intent: /helix_read|concept_read/ },
  { q: "market maker inventory proxy SPX", intent: /spx_desk_read|concept_read/ },
  { q: "dispersion trade single names vs index", intent: /concept_read|market_context/ },
  { q: "correlation SPX components today", intent: /market_context|spx_desk_read/ },
  { q: "index arbitrage ES vs SPX basis", intent: /concept_read|spx_structure/ },
  { q: "futures roll impact on SPX desk", intent: /concept_read|spx_desk_read/ },
  { q: "month-end pension rebalance flow", intent: /market_context|helix_read/ },
  { q: "quarter-end gamma hedging", intent: /concept_read|thermal_read/ },
  { q: "OpEx charm window SPX", intent: /thermal_read|concept_read/ },
  { q: "split adjustment strikes NVDA", intent: /concept_read|vector_read/ },
  { q: "dividend ex-date SPY put skew", intent: /concept_read|vector_read/ },
  { q: "index rebalance QQQ inclusion flow", intent: /helix_read|concept_read/ },
  { q: "ETF creation redemption SPY", intent: /concept_read|helix_read/ },
  { q: "short interest overlay on meme names", intent: /ticker_ecosystem|helix_read/ },
  { q: "gamma squeeze setup GME", intent: /ticker_ecosystem|vector_read/ },
  { q: "earnings implied move vs realized NVDA", intent: /vector_read|verdict/ },
  { q: "post-earnings drift AMD", intent: /ticker_ecosystem|technical_read/ },
  { q: "guidance trade MSFT", intent: /verdict|ticker_ecosystem/ },
  { q: "macro day PPI reaction SPX", intent: /spx_desk_read|market_context/ },
  { q: "CPI day 0DTE positioning SPX", intent: /thermal_read|spx_desk_read/ },
  { q: "FOMC statement gamma flip SPX", intent: /spx_structure|thermal_read/ },
  { q: "NFP release vol crush setup", intent: /concept_read|spx_desk_read/ },
  { q: "fed speaker headline risk", intent: /market_context|clarify_read/ },
  { q: "debt ceiling headline hedge", intent: /market_context|clarify_read/ },
  { q: "geopolitical headline safe haven", intent: /market_context|helix_read/ },
];
