/**
 * Bank 2 — institutional / pro-desk Largo questions (100).
 * Wall dynamics, technicals, play tickets, cross-tool synthesis, strengths/weaknesses.
 */

export const STRESS_BANK_2 = [
  // —— Wall dynamics & dealer structure ——
  { q: "which SPX dealer walls are building vs fading right now", intent: "wall_dynamics_read", avoidDump: /SPX Live Desk read/i },
  { q: "SPX wall ladder and restack status", intent: "wall_dynamics_read", avoidDump: /THESIS.*MECHANIC/s },
  { q: "are gamma walls holding on SPX 0DTE", intent: "wall_dynamics_read" },
  { q: "NVDA dealer walls building or breaking", intent: "wall_dynamics_read", avoidDump: /SPX Live Desk read/i },
  { q: "TSLA gex walls and wall dynamics", intent: "wall_dynamics_read" },
  { q: "which walls matter most on QQQ today", intent: /wall_dynamics_read|vector_read/ },
  { q: "SPY wall integrity near spot", intent: "wall_dynamics_read" },
  { q: "dealer walls on AMD — support vs resistance", intent: "wall_dynamics_read" },

  // —— Play suggestions & actionable tickets ——
  { q: "what should I trade on SPX 0DTE right now", intent: "play_suggest_read", avoidDump: /SPX Live Desk read/i },
  { q: "best play on NVDA today", intent: "play_suggest_read" },
  { q: "give me an actionable SPX trade idea", intent: "play_suggest_read" },
  { q: "recommended strike for SPX calls", intent: /play_suggest_read|verdict/ },
  { q: "desk lean on SPX — what ticket would you put on", intent: "play_suggest_read" },
  { q: "0DTE idea for TSLA", intent: "play_suggest_read" },
  { q: "suggest a play on META", intent: "play_suggest_read" },
  { q: "what would you trade on SPY if forced", intent: "play_suggest_read" },

  // —— Technicals & chart read ——
  { q: "SPX RSI and EMA stack", intent: "technical_read", avoidDump: /SPX Live Desk read/i },
  { q: "NVDA chart setup — trend and ATR", intent: "technical_read" },
  { q: "TSLA technicals overbought or oversold", intent: "technical_read" },
  { q: "QQQ moving averages and RSI(14)", intent: "technical_read" },
  { q: "AMD relative strength vs SMH", intent: /technical_read|ticker_compare/ },
  { q: "SPY support and resistance from Polygon", intent: "technical_read" },
  { q: "META chart read — EMA20 vs EMA50", intent: "technical_read" },
  { q: "AAPL swing high and 20d range", intent: "technical_read" },

  // —— King nodes, magnets, max pain depth ——
  { q: "SPX king node strike and net GEX", intent: "spx_structure", avoidDump: /SPX Live Desk read/i },
  { q: "where is the NVDA king node", intent: /vector_read|spx_structure/ },
  { q: "magnet strike on SPY weekly", intent: "vector_read" },
  { q: "max pain vs spot on SPX 0DTE", intent: /vector_read|spx_structure/ },
  { q: "expected move on QQQ this week", intent: "vector_read" },
  { q: "which strike has the strongest gamma on SPX", intent: /spx_structure|thermal_read/ },

  // —— Flow intelligence ——
  { q: "top 5 HELIX prints by premium today", intent: "helix_read", avoidDump: /SPX desk summary/i },
  { q: "sweep activity on SPX calls last 30 minutes", intent: /helix_read|flow_tape/ },
  { q: "block prints on NVDA", intent: "helix_read" },
  { q: "net premium bias on semiconductors", intent: /helix_read|market_context/ },
  { q: "unusual 0DTE flow on SPY", intent: /helix_read|flow_tape/ },
  { q: "dark pool levels on AAPL", intent: /helix_read|vector_read/ },
  { q: "who is buying QQQ puts", intent: /helix_read|flow_tape/ },

  // —— Strengths / weaknesses synthesis ——
  { q: "strengths and weaknesses of the current SPX setup", intent: "spx_desk_read", avoidDump: /platform snapshot/i },
  { q: "what is working and what is not on NVDA", intent: /ticker_ecosystem|vector_read|verdict/ },
  { q: "bull case vs bear case for SPX into close", intent: "spx_desk_read" },
  { q: "where is the desk wrong on SPX if anything", intent: /spx_desk_read|spx_invalidation/ },
  { q: "friction points in today's SPX read", intent: "spx_desk_read", avoidDump: /SPX desk summary/i },

  // —— Cross-tool alignment ——
  { q: "does HELIX flow agree with SPX dealer gamma", intent: /spx_desk_read|helix_read|thermal_read/ },
  { q: "Night Hawk vs SPX desk alignment", intent: /spx_desk_read|nighthawk_edition/ },
  { q: "play engine vs thermal matrix on SPX", intent: /play_engine_read|thermal_read/ },
  { q: "Cortex vs live flow on NVDA", intent: /cortex_read|helix_read/ },
  { q: "grid scanner vs HELIX on TSLA", intent: /grid_rejections_read|helix_read/ },

  // —— Scenarios & what-if ——
  { q: "if SPX breaks the call wall what happens to dealers", intent: "scenario" },
  { q: "what if VIX spikes 2 points", intent: "scenario" },
  { q: "NVDA down 5% — where is gamma flip then", intent: "scenario" },
  { q: "if we reclaim vwap on SPX does bias flip", intent: /scenario|spx_invalidation/ },

  // —— Invalidation & risk ——
  { q: "where does the SPX bull thesis die", intent: "spx_invalidation" },
  { q: "invalidation for NVDA long setup", intent: /spx_invalidation|vector_read|verdict/ },
  { q: "stop level for current SPX engine play", intent: /play_engine_read|spx_invalidation/ },

  // —— Verdict / advice (professional) ——
  { q: "grade SPX 7540 calls for 0DTE", intent: "verdict" },
  { q: "is it worth selling SPX put spreads here", intent: /verdict|ticker_advice|concept_read/ },
  { q: "should I fade the SPX move at the wall", intent: /verdict|ticker_advice/ },
  { q: "hold AMZN through CPI", intent: "verdict" },

  // —— Thermal deep ——
  { q: "VEX lens on SPX at the flip", intent: "thermal_read", avoidDump: /SPX Live Desk read/i },
  { q: "charm decay headwind on SPX 0DTE", intent: "thermal_read" },
  { q: "DEX positioning on SPY matrix", intent: "thermal_read" },
  { q: "compare thermal GEX vs desk flip on SPX", intent: "thermal_read", avoidDump: /SPX Live Desk read/i },

  // —— Engine state ——
  { q: "committed SPX engine play details", intent: "play_engine_read", avoidDump: /SPX Live Desk read/i },
  { q: "lotto phase and direction on SPX", intent: "play_engine_read" },
  { q: "power hour engine — are we armed", intent: "play_engine_read" },

  // —— Record & platform ——
  { q: "SPX slayer win rate last 30 days", intent: "record_read" },
  { q: "how did 0DTE plays perform this week", intent: "record_read" },
  { q: "snapshot of all live tools", intent: "platform_read" },

  // —— Compare & relative ——
  { q: "SPX vs NDX gamma regime", intent: "ticker_compare" },
  { q: "NVDA vs AVGO dealer positioning", intent: "ticker_compare" },
  { q: "which mag7 name has cleanest flow", intent: /ticker_compare|helix_read/ },

  // —— Night Hawk / Cortex pro ——
  { q: "tonight's Night Hawk edition picks", intent: "nighthawk_edition" },
  { q: "why was NVDA pulled from Night Hawk", intent: "nighthawk_edition" },
  { q: "Cortex rejection reason for AMD", intent: "cortex_read" },

  // —— Diagnostic ——
  { q: "is UW websocket healthy", intent: "system_diagnostic" },
  { q: "why is thermal matrix stale", intent: "system_diagnostic" },

  // —— Narrow / brevity ——
  { q: "one-liner: SPX dealer regime", intent: "spx_desk_read", avoidDump: /ALIGNMENT.*FRICTION/s },
  { q: "SPX put wall only — no essay", intent: "spx_structure", avoidDump: /THESIS/i },

  // —— Compound institutional ——
  { q: "SPX flip, top wall, and best play in one answer", intent: "compound_lookup" },
  { q: "NVDA king node, flow, and technicals", intent: "compound_lookup" },

  // —— Clarify edge ——
  { q: "?", intent: "clarify_read" },
  { q: "help", intent: "clarify_read" },

  // —— Out of scope (must not route to desk dump) ——
  { q: "predict tomorrow's lottery numbers", intent: null },
  { q: "write my tax return", intent: null },

  // —— Pad to 100: pro desk depth ——
  { q: "SPX dealer short gamma chase risk", intent: /spx_desk_read|concept_read/ },
  { q: "long gamma dampening on SPX today", intent: "spx_desk_read" },
  { q: "charm tailwind or headwind SPX EOD", intent: "thermal_read" },
  { q: "VEX flip proximity on SPX", intent: /thermal_read|vector_read/ },
  { q: "net GEX sign on SPX 0DTE", intent: /thermal_read|spx_structure/ },
  { q: "HELIX anomaly near miss on SPX", intent: "helix_read" },
  { q: "strike stack concentration NVDA calls", intent: "helix_read" },
  { q: "expected move vs realized SPX today", intent: /vector_read|spx_desk_read/ },
  { q: "invalidation level for current SPX play ticket", intent: /spx_invalidation|play_suggest_read/ },
  { q: "Cortex pinned evidence for open SPX play", intent: /cortex_read|play_engine_read/ },
  { q: "Night Hawk vs SPX 0DTE overlap", intent: /nighthawk_edition|spx_desk_read/ },
  { q: "compare SPX thermal king vs desk king", intent: /thermal_read|ticker_compare/ },
  { q: "MSFT beads forming on Vector map", intent: /vector_read|system_diagnostic/ },
  { q: "provider cross-check UW vs desk GEX", intent: /thermal_read|system_diagnostic/ },
  { q: "Largo: summarize full SPX stack for risk", intent: /compound_lookup|spx_desk_read/ },
  { q: "what is the weakest link in today's SPX read", intent: "spx_desk_read" },
];
