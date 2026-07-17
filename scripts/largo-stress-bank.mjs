/**
 * 100+ random / adversarial Largo questions for stress testing.
 * Each entry: { q, intentHint?, avoidDump?, topic? }
 * intentHint: preferred intent (string or RegExp)
 * avoidDump: answer must NOT match (full desk / generic market blob)
 */

export const STRESS_BANK = [
  // —— Narrow SPX structure ——
  { q: "just the SPX put wall", intent: "spx_structure", avoidDump: /SPX Live Desk read/i },
  { q: "SPX call wall only", intent: "spx_structure", avoidDump: /THESIS/i },
  { q: "what's the king node on SPX right now", intent: "spx_structure", avoidDump: /SPX Live Desk read/i },
  { q: "gamma flip on SPX", intent: /spx_structure|spx_desk_read/ },
  { q: "SPX max pain today", intent: /spx_structure|vector_read/ },
  { q: "where is SPX trading", intent: /spx_structure|spx_desk_read/ },
  { q: "only answer in one sentence: SPX direction", intent: "spx_desk_read", avoidDump: /ALIGNMENT.*FRICTION/s },
  { q: "one line SPX bias", intent: "spx_desk_read", avoidDump: /SETUP.*RISK/s },

  // —— Thermal / matrix ——
  { q: "what's charm doing on SPX 0DTE", intent: "thermal_read", avoidDump: /SPX Live Desk read/i },
  { q: "compare SPX matrix GEX vs VEX at 7550", intent: "thermal_read", avoidDump: /SPX Live Desk read/i },
  { q: "does thermal agree with the desk on SPX", intent: "thermal_read", avoidDump: /SPX Live Desk read/i },
  { q: "what changed in the matrix in the last 5 minutes", intent: "thermal_read", avoidDump: /HELIX tape.*Night Hawk/s },
  { q: "show me thermal positioning on SPY", intent: "thermal_read" },
  { q: "DEX lens on QQQ", intent: "thermal_read" },

  // —— HELIX / flow ——
  { q: "list only the top 3 HELIX prints by premium", intent: "helix_read", avoidDump: /SPX desk summary/i },
  { q: "any unusual flow right now", intent: "flow_tape" },
  { q: "whale prints on SPX last hour", intent: /helix_read|flow_tape/ },
  { q: "dark pool activity on SPY", intent: "helix_read" },
  { q: "HELIX strike stacks on NVDA", intent: "helix_read" },
  { q: "biggest flow ticker today", intent: /helix_read|flow_tape|market_context/ },

  // —— Engines / plays ——
  { q: "How are today's plays doing?", intent: "zerodte_plays" },
  { q: "grid scanner rejections last hour", intent: "grid_rejections_read", avoidDump: /SPX desk summary/i },
  { q: "SPX lotto engine state", intent: "play_engine_read", avoidDump: /SPX Live Desk read/i },
  { q: "is the play engine long or short right now", intent: "play_engine_read", avoidDump: /SPX desk summary/i },
  { q: "power hour phase on SPX", intent: "play_engine_read" },
  { q: "any 0DTE plays on TSLA", intent: /zerodte_plays|ticker_play_state/ },

  // —— Desk / why ——
  { q: "What's the SPX setup right now?", intent: "spx_desk_read" },
  { q: "why is SPX below vwap", intent: "spx_desk_read" },
  { q: "why did you say bearish and bullish in the same breath", intent: "spx_desk_read", avoidDump: /SPX desk summary/i },
  { q: "what would flip the SPX read", intent: "spx_invalidation" },
  { q: "explain the SPX desk read", intent: "spx_desk_read" },

  // —— Tickers / verdicts ——
  { q: "Should I buy NVDA calls into earnings?", intent: /ticker_advice|verdict/ },
  { q: "is 7550 a good strike for calls today", intent: "verdict" },
  { q: "compare NVDA vs AMD", intent: "ticker_compare" },
  { q: "what's going on with TSLA", intent: "ticker_ecosystem" },
  { q: "hold COIN into earnings", intent: "verdict" },
  { q: "is META risk-on", intent: /verdict|ticker_advice/ },
  { q: "AMD max pain", intent: "vector_read" },
  { q: "QQQ expected move", intent: "vector_read" },
  { q: "NVDA gamma flip distance", intent: "vector_read" },
  { q: "which is closer to flip SPX or NVDA", intent: "ticker_compare" },

  // —— Night Hawk / Cortex ——
  { q: "nighthawk play on NVDA tonight", intent: "nighthawk_edition" },
  { q: "why was CSX picked tonight", intent: "nighthawk_edition" },
  { q: "cortex verdict on NVDA", intent: "cortex_read" },
  { q: "why did we skip TSLA", intent: "cortex_read" },

  // —— Market / VIX ——
  { q: "What's the market doing?", intent: "market_context" },
  { q: "what's VIX doing and does it matter for today's SPX read", intent: "market_context", avoidDump: /SPX Live Desk read/i },
  { q: "market tide bias", intent: /market_context|spx_desk_read/ },
  { q: "is the market risk-on today", intent: "verdict" },

  // —— Concepts ——
  { q: "GEX?", intent: "concept_read" },
  { q: "what is a king node", intent: "concept_read" },
  { q: "define vanna", intent: "concept_read" },
  { q: "what does Night Hawk do", intent: "concept_read" },

  // —— Platform / record ——
  { q: "full platform snapshot", intent: "platform_read" },
  { q: "track record win rate", intent: "record_read" },
  { q: "how have plays performed historically", intent: "record_read" },

  // —— Scenarios ——
  { q: "if SPX drops 1% what happens to gamma", intent: "scenario" },
  { q: "what if NVDA rips 3%", intent: "scenario" },
  { q: "if we lose the gamma flip on SPX", intent: /scenario|spx_invalidation/ },

  // —— Vector explicit ——
  { q: "vector setup on NVDA 0DTE", intent: "vector_read" },
  { q: "SPX weekly max pain", intent: "vector_read" },
  { q: "where does SPY magnet", intent: "vector_read" },

  // —— Compound / edge ——
  { q: "What's SPX gamma flip and also AMD max pain and also any whale flow", intent: "compound_lookup" },
  { q: "GEX? VEX? max pain? king node?", intent: /compound_lookup|concept_read/ },

  // —— Clarify / garbage ——
  { q: "asdfghjkl", intent: "clarify_read", avoidDump: /SPX desk summary/i },
  { q: "1", intent: "clarify_read", avoidDump: /γflip/i },
  { q: "tell me something you don't know", intent: "clarify_read", avoidDump: /SPX desk summary/i },
  { q: "???", intent: "clarify_read" },
  { q: "hi", intent: "clarify_read" },

  // —— Random retail word salad ——
  { q: "are we gonna rip or dip into close", intent: /spx_desk_read|market_context|clarify_read/ },
  { q: "is it a good day to sell premium", intent: /spx_desk_read|ticker_advice|clarify_read/ },
  { q: "dealer hedging if I buy 7530 puts", intent: /scenario|concept_read|spx_structure|clarify_read/ },
  { q: "pin risk at 7500 into expiration", intent: /spx_structure|verdict|spx_desk_read/ },
  { q: "0DTE theta burn on SPX calls", intent: /concept_read|spx_desk_read|thermal_read/ },
  { q: "semiconductor sector flow", intent: /helix_read|flow_tape|market_context/ },
  { q: "mag7 breadth today", intent: /market_context|spx_desk_read/ },
  { q: "IWM vs SPY relative strength", intent: "ticker_compare" },
  { q: "oil impact on SPX today", intent: /market_context|spx_desk_read|clarify_read/ },
  { q: "FOMC week gamma positioning", intent: /thermal_read|spx_desk_read/ },
  { q: "pre-market gap on ES", intent: /spx_structure|spx_desk_read/ },
  { q: "opening range breakout SPX", intent: /spx_desk_read|concept_read/ },
  { q: "lunch chop avoid zone", intent: /spx_desk_read|concept_read/ },
  { q: "MOC imbalance", intent: /concept_read|helix_read|clarify_read/ },
  { q: "tick index extreme", intent: /spx_desk_read|concept_read/ },
  { q: "put call ratio SPX", intent: /spx_desk_read|helix_read/ },
  { q: "skew on SPX 0DTE", intent: /thermal_read|vector_read/ },
  { q: "iron condor at 7500/7550", intent: /concept_read|verdict|spx_structure/ },
  { q: "calendar spread on SPY", intent: /concept_read|clarify_read/ },
  { q: "leaps on NVDA not 0DTE", intent: "vector_read" },

  // —— More ticker chaos ——
  { q: "PLTR unusual options", intent: /helix_read|ticker_ecosystem/ },
  { q: "SMCI blow-off top?", intent: /ticker_ecosystem|ticker_advice/ },
  { q: "AAPL into iPhone event", intent: /verdict|ticker_advice/ },
  { q: "GLD safe haven flow", intent: /helix_read|ticker_ecosystem/ },
  { q: "BTC correlation to QQQ today", intent: /market_context|clarify_read/ },
  { q: "banks weak XLF", intent: /ticker_ecosystem|vector_read/ },
  { q: "UNH recovery trade", intent: /ticker_advice|ticker_ecosystem/ },
  { q: "meme basket GME AMC", intent: /ticker_compare|helix_read/ },

  // —— Vector Pulse / walls / technicals ——
  { q: "What just changed on NVDA?", intent: "vector_pulse_read", avoidDump: /SPX Live Desk read/i },
  { q: "Vector Pulse on SPY", intent: "vector_pulse_read" },
  { q: "recent wall events on QQQ", intent: "vector_pulse_read" },
  { q: "which walls are building on SPX", intent: "wall_dynamics_read", avoidDump: /SPX Live Desk read/i },
  { q: "RSI on NVDA", intent: "technical_read" },
  { q: "QQQ 15m technicals", intent: "vector_read" },
  { q: "what should I trade on SPX today", intent: "play_suggest_read" },

  // —— Diagnostic ——
  { q: "why isn't SPX GEX updating", intent: "system_diagnostic" },
  { q: "is the flow pipeline healthy", intent: "system_diagnostic" },

  // —— Universal lookup shape ——
  { q: "pull /api/market/spx/desk", intent: "universal_lookup" },

  // —— Out of scope ——
  { q: "write me a poem about theta", intent: null },
  { q: "explain quantum physics", intent: null },
];

export function intentMatches(actual, hint) {
  if (hint == null) return actual == null;
  if (typeof hint === "string") return actual === hint;
  return hint.test(actual ?? "");
}

export { scoreAnswer } from "./largo-stress-scoring.mjs";
