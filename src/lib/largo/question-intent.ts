import type { AnthropicMessage } from "@/lib/providers/anthropic";

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
const KNOWN_TICKERS = new Set([
  "SPX", "SPY", "QQQ", "IWM", "VIX", "NDX", "ES", "NQ", "NVDA", "AAPL", "TSLA", "META", "MSFT", "AMZN", "GOOG", "GOOGL",
  "ASTS", "AMD", "COIN", "PLTR", "SOFI", "HOOD", "GME", "AMC",
]);

function recentUserText(history: AnthropicMessage[], limit = 6): string {
  return history
    .slice(-limit)
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join(" ");
}

function extractTicker(question: string, historyText: string): string | null {
  const combined = `${historyText} ${question}`;
  const matches = combined.toUpperCase().match(TICKER_RE) ?? [];
  for (const raw of matches) {
    if (KNOWN_TICKERS.has(raw)) return raw;
  }
  const qMatch = question.toUpperCase().match(/\b([A-Z]{2,5})\b/);
  if (qMatch && qMatch[1] !== "THE" && qMatch[1] !== "AND") return qMatch[1];
  return null;
}

/** Light hints for this turn — Largo decides how much to pull and how to express it. */
export function analyzeLargoQuestion(
  question: string,
  history: AnthropicMessage[]
): LargoQuestionIntent {
  const ctx = `${recentUserText(history)} ${question}`.toLowerCase();

  const needsSpxDesk =
    /\b(spx|s&p 500|s&p|0dte|sniper|gamma flip|gex|dealer|max pain|vwap|hod|lod|pdh|pdl|internals|tick|trin)\b/.test(
      ctx
    );
  const needsPlayState =
    /\b(buy|sell|hold|trim|play|setup|trade|lotto|signal|outlook|analysis)\b/.test(ctx);
  const needsFlow =
    /\b(flow|sweep|whale|dark pool|tape|premium|unusual|sweeps|nope|tide)\b/.test(ctx);
  const needsNews = /\b(news|headline|catalyst|earnings|cpi|fomc|macro|calendar)\b/.test(ctx);
  const needsVol = /\b(iv|vol|vix|skew|rank|realized)\b/.test(ctx);

  const tickerHint = extractTicker(question, recentUserText(history));
  const scopeTicker = tickerHint ?? (needsSpxDesk ? "SPX" : null);

  const toolHints: string[] = ["get_market_context"];

  if (needsSpxDesk || scopeTicker === "SPX") {
    toolHints.push("get_spx_structure", "get_gex");
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

  const uniqueTools = Array.from(new Set(toolHints));

  const guidance = [
    `User asked: "${question.trim().slice(0, 320)}"`,
    scopeTicker ? `Ticker context: ${scopeTicker}.` : "No ticker pinned — infer from chat if needed.",
    "A live feed was auto-captured for this turn (flow, news, catalysts, technicals, dark pool, SPX desk). Synthesize it — don't dump it raw.",
    `Tool hints for drill-down if needed: ${uniqueTools.join(", ")}.`,
    "End with **Bottom line:** when substantive — your honest take in your voice.",
  ].join("\n");

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
