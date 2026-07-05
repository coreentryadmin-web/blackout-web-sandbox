import type { AnthropicMessage } from "@/lib/providers/anthropic";
import {
  FLOW_ANOMALY_NEAR_MISS_RE,
  FLOW_RE,
  GEX_REGIME_HISTORY_RE,
  MARKET_REGIME_RE,
  matchesIntent,
  NEWS_RE,
  NIGHTHAWK_RE,
  PLAY_STATE_RE,
  SPX_DESK_RE,
  SPX_ENGINE_STATE_RE,
  VOL_RE,
  ZERODTE_COMMAND_RE,
  ZERODTE_REJECTION_RE,
} from "@/lib/largo/intent-keywords";

export type LargoQuestionIntent = {
  needsSpxDesk: boolean;
  needsPlayState: boolean;
  needsFlow: boolean;
  needsNews: boolean;
  needsVol: boolean;
  /** SPX Slayer's OWN play-engine phase/gates/confluence wording — hints get_spx_play (LARGO-110). */
  needsSpxEngineState: boolean;
  /** Market-wide backdrop/regime wording, distinct from the above — hints get_market_regime (LARGO-110). */
  needsMarketRegime: boolean;
  /** 0DTE Command's OWN multi-ticker scanner ("grid scanner," "0dte command," hunt/scan/find
   *  wording) — hints get_zerodte_plays, distinct from SPX Slayer's own 0DTE engine above
   *  which the bare "0dte" token in SPX_DESK_RE/PLAY_STATE_RE/SPX_ENGINE_STATE_RE already
   *  covers (task #127). */
  needsZeroDteCommand: boolean;
  /** 0DTE Command near-miss/rejection wording ("why didn't X make the grid board," "near
   *  miss," "what gate did X fail") — hints get_zerodte_rejections (task #147), distinct
   *  from needsZeroDteCommand above (the committed-plays board) and from
   *  needsSpxEngineState (SPX Slayer's own rejected/scanning history). */
  needsZeroDteRejections: boolean;
  /** BlackOut Thermal's GEX regime/flip/wall-crossing HISTORY wording ("when did the
   *  flip last cross," "how many times has the wall moved today") — hints
   *  get_gex_regime_events (task #136), distinct from needsSpxDesk/get_gex's
   *  CURRENT-snapshot-only view. */
  needsGexRegimeHistory: boolean;
  /** HELIX flow-anomaly near-miss/rejection wording ("why didn't HELIX flag X," "near miss
   *  on the anomaly scan") — hints get_flow_anomaly_near_misses (task #131), distinct from
   *  needsMarketRegime above (get_market_regime's committed-anomaly COUNT only) and from
   *  needsZeroDteRejections (0DTE Command's own separate scanner/threshold set). */
  needsFlowAnomalyNearMisses: boolean;
  tickerHint: string | null;
  guidance: string;
};

const TICKER_RE = /\b([A-Z]{1,5})\b/g;
export const KNOWN_TICKERS = new Set([
  "SPX", "SPY", "QQQ", "IWM", "VIX", "NDX", "ES", "NQ", "DIA", "VOO", "IVV", "RSP",
  "XLF", "XLE", "XLK", "XLV", "XLI", "XLP", "XLU", "XLY", "XLRE", "XLB", "XLC",
  "TQQQ", "SQQQ", "GLD", "SLV", "USO", "UNG", "TLT", "HYG", "SMH", "SOXX", "ARKK",
  "NVDA", "AAPL", "TSLA", "META", "MSFT", "AMZN", "GOOG", "GOOGL", "BRK", "BRKB",
  "JPM", "V", "MA", "UNH", "JNJ", "PG", "HD", "CVX", "LLY", "AVGO", "COST", "WMT",
  "CRM", "NFLX", "AMD", "INTC", "ORCL", "ADBE", "BAC", "XOM", "DIS", "PEP", "KO",
  "ABBV", "MRK", "TMO", "CSCO", "ACN", "MCD", "ABT", "DHR", "TXN", "QCOM", "IBM",
  "GE", "CAT", "GS", "MS", "BLK", "SCHW", "AXP", "NOW", "UBER", "PYPL", "SQ",
  "ASTS", "COIN", "PLTR", "SOFI", "HOOD", "GME", "AMC", "MSTR", "SMCI", "ARM",
]);

function recentUserText(history: AnthropicMessage[], limit = 6): string {
  return history
    .slice(-limit)
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join(" ");
}

function extractTicker(question: string, historyText: string): string | null {
  // Normalise to uppercase so mixed-case and ALL-CAPS questions are handled identically.
  const qUpper = question.toUpperCase();
  const qMatch = qUpper.match(/\$?\b([A-Z]{2,5})\b/g) ?? [];
  for (let i = qMatch.length - 1; i >= 0; i--) {
    const hadDollar = qMatch[i].startsWith("$");
    const cand = qMatch[i].replace(/^\$/, "");
    // Only accept a known ticker or an explicit $-prefixed symbol. The old
    // "any caps token not on the blocklist" branch mis-pinned words like
    // CALLS / HOLD / SETUP / BULL as tickers (LARGO-9).
    if (KNOWN_TICKERS.has(cand) || hadDollar) return cand;
  }
  const combined = `${historyText} ${question}`;
  const matches = combined.toUpperCase().match(TICKER_RE) ?? [];
  for (let i = matches.length - 1; i >= 0; i--) {
    const raw = matches[i];
    if (KNOWN_TICKERS.has(raw)) return raw;
  }
  return null;
}

/** Light hints for this turn — Largo decides how much to pull and how to express it. */
export function analyzeLargoQuestion(
  question: string,
  history: AnthropicMessage[]
): LargoQuestionIntent {
  const ctx = `${recentUserText(history)} ${question}`.toLowerCase();

  const needsSpxDesk = matchesIntent(ctx, SPX_DESK_RE);
  const needsPlayState = matchesIntent(ctx, PLAY_STATE_RE);
  const needsFlow = matchesIntent(ctx, FLOW_RE);
  const needsNews = matchesIntent(ctx, NEWS_RE);
  const needsVol = matchesIntent(ctx, VOL_RE);
  const needsNightHawk = matchesIntent(ctx, NIGHTHAWK_RE);
  const needsSpxEngineState = matchesIntent(ctx, SPX_ENGINE_STATE_RE);
  const needsMarketRegime = matchesIntent(ctx, MARKET_REGIME_RE);
  const needsZeroDteCommand = matchesIntent(ctx, ZERODTE_COMMAND_RE);
  const needsZeroDteRejections = matchesIntent(ctx, ZERODTE_REJECTION_RE);
  const needsGexRegimeHistory = matchesIntent(ctx, GEX_REGIME_HISTORY_RE);
  const needsFlowAnomalyNearMisses = matchesIntent(ctx, FLOW_ANOMALY_NEAR_MISS_RE);

  const tickerHint = extractTicker(question, recentUserText(history));
  const scopeTicker = tickerHint ?? (needsSpxDesk ? "SPX" : null);

  const toolHints: string[] = ["get_market_context"];

  if (needsSpxDesk || scopeTicker === "SPX") {
    toolHints.push("get_spx_structure", "get_gex", "get_greek_flow");
  }
  if (needsPlayState) {
    toolHints.push("get_spx_play", "get_open_plays");
  }
  if (scopeTicker) {
    toolHints.push("get_quote", "get_technicals", "get_news", "get_options_flow", "get_dark_pool");
  }
  if (needsFlow) {
    toolHints.push("get_global_flow", "get_flow_per_strike");
  }
  if (needsNews) {
    toolHints.push("get_economic_calendar", "get_web_search");
  }
  if (needsVol) {
    toolHints.push("get_volatility_regime", "get_iv_stats");
  }
  if (needsNightHawk) {
    toolHints.push("get_nighthawk_edition", "get_platform_snapshot");
  }
  if (needsFlow) {
    toolHints.push("get_flow_tape");
  }
  // Engine-state ("what phase is SPX Slayer in", "why did the play get rejected") vs
  // market-wide-regime ("what's the market regime today", "good environment for calls")
  // wording route to two different tools that Claude otherwise conflates on the word
  // "regime" alone (LARGO-110) — keep these two hints mutually exclusive in practice
  // since SPX_ENGINE_STATE_RE and MARKET_REGIME_RE target disjoint vocabulary.
  if (needsSpxEngineState) {
    toolHints.push("get_spx_play");
  }
  if (needsMarketRegime) {
    toolHints.push("get_market_regime");
  }
  // 0DTE Command's own multi-ticker scanner board (grid scanner/hunt/find wording
  // paired with 0dte, or the "0dte command"/"command board" name itself) — a
  // STRONGER, more specific hint than the bare "0dte" token above, which every
  // needsSpxDesk/needsPlayState/needsSpxEngineState branch already fires on and
  // which nudges toward SPX Slayer's OWN tools instead. Both engines are branded
  // "0DTE," so leaving a bare mention to hint only SPX Slayer's tools would be
  // wrong for a genuinely scanner-scoped question — this hint doesn't replace
  // those (a bare "0dte" is still ambiguous on purpose, see question-intent.test.ts),
  // it adds get_zerodte_plays with more force when the wording actually names the
  // scanner (task #127).
  if (needsZeroDteCommand) {
    toolHints.push("get_zerodte_plays");
  }
  // Near-miss/rejection wording ("why didn't X make the board," "near miss," "what
  // gate did X fail") — a DIFFERENT question from needsZeroDteCommand above (which
  // asks about the committed-plays board): this hints the gate-rejection log
  // instead, so a candidate that never cleared every gate is still answerable.
  if (needsZeroDteRejections) {
    toolHints.push("get_zerodte_rejections");
  }
  // GEX regime/flip/wall-crossing HISTORY wording ("when did the flip last cross,"
  // "how many times has the wall moved today") — a DIFFERENT question from
  // get_gex/get_positioning (current snapshot only, no memory of earlier crosses).
  if (needsGexRegimeHistory) {
    toolHints.push("get_gex_regime_events");
  }
  // HELIX flow-anomaly near-miss wording ("why didn't HELIX flag X," "near miss on
  // the anomaly scan") — a DIFFERENT question from needsMarketRegime above (which
  // only ever surfaces the COUNT of anomalies that already fired): this hints the
  // near-miss log instead, so a candidate that never cleared the anomaly threshold
  // (or fired but was dedup-suppressed) is still answerable.
  if (needsFlowAnomalyNearMisses) {
    toolHints.push("get_flow_anomaly_near_misses");
  }

  const uniqueTools = Array.from(new Set(toolHints));

  const guidance = [
    `User asked: "${question.trim().slice(0, 320)}"`,
    scopeTicker ? `Ticker context: ${scopeTicker}.` : "No ticker pinned — infer from chat if needed.",
    "Live feed auto-captured this turn. Every figure you cite must be in that feed or a tool call you make now — no guessing, no invented stacks or premiums.",
    needsFlow
      ? "Flow question: use strike_stacks from feed/tools if present; if absent, do not describe a stack. Call get_options_flow if tape looks incomplete."
      : null,
    `Tool hints if needed: ${uniqueTools.join(", ")}.`,
    "End with **Bottom line:** when substantive — opinion there; facts above must stay feed-verified.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    needsSpxDesk,
    needsPlayState,
    needsFlow,
    needsNews,
    needsVol,
    needsSpxEngineState,
    needsMarketRegime,
    needsZeroDteCommand,
    needsZeroDteRejections,
    needsGexRegimeHistory,
    needsFlowAnomalyNearMisses,
    tickerHint,
    guidance,
  };
}
