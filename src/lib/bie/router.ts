// BLACKOUT Intelligence Engine — Layer 3 router (pure classification half).
// The router answers member questions DETERMINISTICALLY when the question maps
// onto data the platform already computes — no LLM call, no latency, no cost,
// and zero hallucination risk, because the answer is composed from the same
// source-of-truth readers every dashboard uses. Anything ambiguous falls through
// to Claude (the general-reasoning fallback). Conservative by design: a missed
// route costs one Claude call; a wrong route costs trust. When unsure → null.

import { KNOWN_TICKERS } from "@/lib/largo/question-intent";

export type BieIntent =
  | "zerodte_plays"
  | "ticker_play_state"
  | "spx_structure"
  | "spx_desk_read"
  | "spx_invalidation"
  | "market_context"
  | "flow_tape"
  | "ticker_ecosystem"
  | "ticker_advice"
  | "ticker_compare";

export type BieRoute = {
  intent: BieIntent;
  ticker: string | null;
  /** Second ticker for compare intent. */
  ticker_b?: string | null;
};

const ZERODTE_RE =
  /\b(0\s*dte|zero\s*dte|zerodte)\b.*\b(plays?|board|scanner|finds?)\b|\b(today'?s|the)\s+plays\b|command board|how (are|did) (the|our|today'?s) plays/i;

const SPX_STRUCTURE_RE =
  /\b(spx|es|s&p)\b[^?]*\b(levels?|structure|walls?|gamma( flip)?|flip|max pain|king node|support|resistance)\b|\b(levels?|structure|walls?|gamma flip|max pain)\b[^?]*\bspx\b/i;

const SPX_DESK_READ_RE =
  /\b(spx|s&p|es)\b.*\b(read|setup|bias|trade|desk|update|doing|look(ing)?|now|slayer|channel|commentary|brief)\b|\bwhat'?s? (the )?(spx|s&p) (setup|read|trade|bias|desk|doing)\b|\blive desk\b.*\bspx\b|\bspx channel\b|\bcommentary on spx\b/i;

const SPX_INVALIDATION_RE =
  /\b(invalidate|invalidat|kill|what (would|kills)|thesis dead|go flat)\b.*\b(spx|setup|read|play|slayer)\b|\b(spx|setup|play|slayer)\b.*\b(invalidate|kill|flip it|lose)\b|\bwhat would flip\b/i;

const MARKET_CONTEXT_RE =
  /^(what('| i)s (the )?market (doing|look(ing)? like|context|structure)( (right )?now| today)?\??|market (context|overview|check)( please)?\??|how('| i)s the market( (right )?now| today| looking)?\??)$/i;

const PLAY_STATE_RE = /\b(play|position|status|doing|hold|trim|exit|sell|still (valid|good|on))\b/i;

const TICKER_ECOSYSTEM_RE =
  /\bwhat'?s? (going on|happening) (with|on)\b|\bwhat'?s? the (word|story|deal|latest) (with|on)\b|\bany (info|news|flow|activity) on\b|\banything (on|about)\b/i;

const SPX_WHY_RE =
  /\bwhy\b.*\b(spx|s&p|es|gamma|gex|vwap|dealers?|flip|slayer|market|tape)\b|\b(spx|s&p|slayer)\b.*\bwhy\b/i;

const SPX_EXPLAIN_RE =
  /\bexplain\b.*\b(spx|s&p|es|slayer)\b|\b(spx|s&p|es|slayer)\b.*\bexplain\b/i;

const MARKET_CONTEXT_LOOSE_RE =
  /\b(market (doing|look(ing)?|context|overview|backdrop|regime)|how.?s the market|what.?s the market|market tape|tape today)\b/i;

const FLOW_TAPE_RE =
  /\b(unusual flow|whale print|flow tape|any flow|big flow|hedging flows?|massive flow|lit flow)\b/i;

const ADVICE_RE =
  /\b(should i|would you|can i|worth (buying|selling)|buy|sell|hold|trim|into earnings|before earnings|after earnings)\b/i;

const COMPARE_RE = /\b(compare|versus|vs\.?)\b/i;

/** Questions with these shapes need REASONING, not lookup — Claude unless a narrower BIE branch matched first. */
const REASONING_RE =
  /\b(why|explain|compare|versus|vs\.?|should i|would you|what if|predict|forecast|think|opinion|strategy|teach|how do(es)? .{0,20}work)\b/i;

function extractKnownTicker(question: string): string | null {
  const matches = question.toUpperCase().match(/\$?\b[A-Z]{1,5}\b/g) ?? [];
  for (const m of matches) {
    const hadDollar = m.startsWith("$");
    const cand = m.replace(/^\$/, "");
    if (hadDollar || KNOWN_TICKERS.has(cand)) return cand;
  }
  return null;
}

/** Up to two known tickers for compare routing. */
export function extractCompareTickers(question: string): [string, string] | null {
  const matches = question.toUpperCase().match(/\$?\b[A-Z]{1,5}\b/g) ?? [];
  const found: string[] = [];
  for (const m of matches) {
    const hadDollar = m.startsWith("$");
    const cand = m.replace(/^\$/, "");
    if (hadDollar || KNOWN_TICKERS.has(cand)) {
      if (!found.includes(cand)) found.push(cand);
    }
    if (found.length >= 2) break;
  }
  return found.length >= 2 ? [found[0]!, found[1]!] : null;
}

export function classifyBieIntent(question: string, ledgerTickers: Set<string>): BieRoute | null {
  const q = question.trim();
  if (q.length > 160 || q.split(/[.?!]/).filter((s) => s.trim()).length > 2) return null;

  if (SPX_WHY_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (SPX_EXPLAIN_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (SPX_INVALIDATION_RE.test(q)) return { intent: "spx_invalidation", ticker: "SPX" };

  if (COMPARE_RE.test(q)) {
    const pair = extractCompareTickers(q);
    if (pair) return { intent: "ticker_compare", ticker: pair[0], ticker_b: pair[1] };
  }

  if (ADVICE_RE.test(q)) {
    const ticker = extractKnownTicker(q);
    if (ticker) return { intent: "ticker_advice", ticker };
  }

  if (FLOW_TAPE_RE.test(q)) {
    return { intent: "flow_tape", ticker: extractKnownTicker(q) };
  }

  if (REASONING_RE.test(q)) return null;

  if (ZERODTE_RE.test(q)) return { intent: "zerodte_plays", ticker: null };

  const caps = q.toUpperCase().match(/\$?\b[A-Z]{1,5}\b/g) ?? [];
  const hit = caps.map((c) => c.replace(/^\$/, "")).find((c) => ledgerTickers.has(c));
  if (hit && PLAY_STATE_RE.test(q)) return { intent: "ticker_play_state", ticker: hit };

  if (SPX_STRUCTURE_RE.test(q)) return { intent: "spx_structure", ticker: "SPX" };
  if (SPX_DESK_READ_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (MARKET_CONTEXT_RE.test(q) || MARKET_CONTEXT_LOOSE_RE.test(q)) {
    return { intent: "market_context", ticker: null };
  }

  if (TICKER_ECOSYSTEM_RE.test(q)) {
    const ticker = extractKnownTicker(q);
    if (ticker) return { intent: "ticker_ecosystem", ticker };
  }

  return null;
}

export function isSpxDeskFallbackQuestion(question: string): boolean {
  const q = question.trim();
  if (q.length > 200 || q.split(/[.?!]/).filter((s) => s.trim()).length > 2) return false;
  if (REASONING_RE.test(q) && !/\b(spx|s&p|gamma|gex|dealer)\b/i.test(q)) return false;
  return /\b(spx|s&p|es|slayer|sniper|0dte|gamma|gex|dealer)\b/i.test(q);
}

export function classifyBieStagingFallback(question: string): BieRoute {
  const q = question.trim();
  if (ZERODTE_RE.test(q)) return { intent: "zerodte_plays", ticker: null };
  if (SPX_INVALIDATION_RE.test(q)) return { intent: "spx_invalidation", ticker: "SPX" };
  if (SPX_STRUCTURE_RE.test(q) || SPX_DESK_READ_RE.test(q) || SPX_WHY_RE.test(q) || SPX_EXPLAIN_RE.test(q)) {
    return { intent: "spx_desk_read", ticker: "SPX" };
  }
  if (FLOW_TAPE_RE.test(q)) return { intent: "flow_tape", ticker: extractKnownTicker(q) };
  if (MARKET_CONTEXT_RE.test(q) || MARKET_CONTEXT_LOOSE_RE.test(q)) {
    return { intent: "market_context", ticker: null };
  }
  const pair = extractCompareTickers(q);
  if (pair) return { intent: "ticker_compare", ticker: pair[0], ticker_b: pair[1] };
  const ticker = extractKnownTicker(q);
  if (ticker && ADVICE_RE.test(q)) return { intent: "ticker_advice", ticker };
  if (ticker && PLAY_STATE_RE.test(q)) return { intent: "ticker_ecosystem", ticker };
  if (TICKER_ECOSYSTEM_RE.test(q) && ticker) return { intent: "ticker_ecosystem", ticker };
  if (/\b(spx|s&p|gamma|gex|vwap|slayer|0dte|dealer|flip)\b/i.test(q)) {
    return { intent: "spx_desk_read", ticker: "SPX" };
  }
  if (/\b(market|vix|spy|qqq|breadth|regime|tape|anomal)/i.test(q)) {
    return { intent: "market_context", ticker: null };
  }
  if (ticker) return { intent: "ticker_advice", ticker };
  return { intent: "market_context", ticker: null };
}

export function bieIntentBucket(intent: BieIntent | null): string {
  return intent ?? "claude_fallback";
}

export function bieFollowups(intent: BieIntent): string[] {
  switch (intent) {
    case "zerodte_plays":
      return ["Why was the top play picked?", "What's the SPX setup right now?", "Any fresh finds on the radar?"];
    case "ticker_play_state":
      return ["Show all of today's plays", "What would invalidate this play?", "What's the SPX setup right now?"];
    case "spx_structure":
      return ["What's the full SPX desk read?", "What would flip this read?", "How are today's plays doing?"];
    case "spx_desk_read":
      return ["Where are dealers positioned?", "What would flip this read?", "How are today's plays doing?"];
    case "spx_invalidation":
      return ["What's the full SPX desk read?", "How are today's plays doing?", "What's the market doing?"];
    case "market_context":
      return ["What's the SPX setup right now?", "How are today's plays doing?", "Any unusual flow right now?"];
    case "flow_tape":
      return ["What's the SPX setup right now?", "What's going on with SPY?", "How are today's plays doing?"];
    case "ticker_ecosystem":
      return ["Is that confirmed by Night Hawk too?", "How are today's plays doing?", "What's the SPX setup right now?"];
    case "ticker_advice":
      return ["What's the SPX setup right now?", `Compare with another name`, "How are today's plays doing?"];
    case "ticker_compare":
      return ["What's the SPX setup right now?", "How are today's plays doing?", "Any unusual flow right now?"];
  }
}
