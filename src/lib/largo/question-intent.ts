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
  "SPX", "SPY", "QQQ", "IWM", "VIX", "NVDA", "AAPL", "TSLA", "META", "MSFT", "AMZN", "GOOG", "GOOGL",
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

/** Decide which live tools to emphasize — never inject full desk JSON into the prompt. */
export function analyzeLargoQuestion(
  question: string,
  history: AnthropicMessage[]
): LargoQuestionIntent {
  const q = question.toLowerCase();
  const ctx = `${recentUserText(history)} ${question}`.toLowerCase();

  const needsSpxDesk =
    /\b(spx|s&p 500|s&p|0dte|sniper|gamma flip|gex|dealer|max pain|vwap|hod|lod|pdh|pdl|internals|tick|trin)\b/.test(
      ctx
    );
  const needsPlayState =
    /\b(buy|sell|hold|trim|play engine|open play|watching|scanning|lotto|signal)\b/.test(ctx);
  const needsFlow =
    /\b(flow|sweep|whale|dark pool|tape|premium|unusual|sweeps)\b/.test(ctx);
  const needsNews = /\b(news|headline|catalyst|earnings|cpi|fomc|macro)\b/.test(ctx);
  const needsVol = /\b(iv|vol|vix|skew|rank|realized)\b/.test(ctx);

  const tickerHint = extractTicker(question, recentUserText(history));

  const tools: string[] = [];
  if (needsSpxDesk) tools.push("get_spx_structure");
  if (needsPlayState) tools.push("get_spx_play", "get_open_plays");
  if (needsFlow && tickerHint === "SPX") tools.push("get_options_flow");
  else if (needsFlow) tools.push("get_options_flow", "get_global_flow");
  if (needsNews) tools.push("get_news");
  if (needsVol) tools.push("get_volatility_regime");
  if (tickerHint && tickerHint !== "SPX") tools.push("get_quote");
  if (!tools.length) tools.push("get_market_context");

  const guidance = [
    `User asked: "${question.trim().slice(0, 280)}"`,
    "Respond ONLY to that question — no unsolicited desk recap, no raw JSON dumps, no metric laundry lists.",
    `Call the minimum tools needed (suggested: ${tools.slice(0, 4).join(", ")}). Use tool output numbers verbatim.`,
    tickerHint ? `Ticker in scope: ${tickerHint}.` : "Infer ticker from conversation if the user uses 'it' or 'that name'.",
    needsSpxDesk
      ? "For SPX: use get_spx_structure for live merged desk — cite only fields relevant to the question."
      : null,
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
