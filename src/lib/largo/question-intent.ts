import type { AnthropicMessage } from "@/lib/providers/anthropic";
import {
  FLOW_RE,
  matchesIntent,
  NEWS_RE,
  NIGHTHAWK_RE,
  PLAY_STATE_RE,
  SPX_DESK_RE,
  VOL_RE,
} from "@/lib/largo/intent-keywords";

export type LargoQuestionIntent = {
  needsSpxDesk: boolean;
  needsPlayState: boolean;
  needsFlow: boolean;
  needsNews: boolean;
  needsVol: boolean;
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
    tickerHint,
    guidance,
  };
}
