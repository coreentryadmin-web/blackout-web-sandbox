// BLACKOUT Intelligence Engine — Layer 3 router (pure classification half).
// The router answers member questions DETERMINISTICALLY when the question maps
// onto data the platform already computes — no LLM call, no latency, no cost,
// and zero hallucination risk, because the answer is composed from the same
// source-of-truth readers every dashboard uses. Anything ambiguous falls through
// to Claude (the general-reasoning fallback). Conservative by design: a missed
// route costs one Claude call; a wrong route costs trust. When unsure → null.

import { KNOWN_TICKERS } from "@/lib/largo/question-intent";

export type BieIntent =
  | "zerodte_plays" // "how are today's plays doing" / the 0DTE board
  | "ticker_play_state" // "how's the NVDA play" — a name on today's ledger
  | "spx_structure" // "SPX levels / walls / gamma flip"
  | "market_context" // "what's the market doing right now"
  | "ticker_ecosystem"; // "what's going on with NVDA" — any known ticker, not just today's ledger

export type BieRoute = {
  intent: BieIntent;
  ticker: string | null;
};

const ZERODTE_RE =
  /\b(0\s*dte|zero\s*dte|zerodte)\b.*\b(plays?|board|scanner|finds?)\b|\b(today'?s|the)\s+plays\b|command board|how (are|did) (the|our|today'?s) plays/i;

const SPX_STRUCTURE_RE =
  /\b(spx|es|s&p)\b[^?]*\b(levels?|structure|walls?|gamma( flip)?|flip|max pain|king node|support|resistance)\b|\b(levels?|structure|walls?|gamma flip|max pain)\b[^?]*\bspx\b/i;

const MARKET_CONTEXT_RE =
  /^(what('| i)s (the )?market (doing|look(ing)? like|context|structure)( (right )?now| today)?\??|market (context|overview|check)( please)?\??|how('| i)s the market( (right )?now| today| looking)?\??)$/i;

const PLAY_STATE_RE = /\b(play|position|status|doing|hold|trim|exit|sell|still (valid|good|on))\b/i;

// Deliberately excludes "think"/"opinion"/"take on this" phrasing that could
// read as wanting reasoning, not a data dump — REASONING_RE below already
// sends anything with "think" to Claude, so a branch built around it here
// would be dead code anyway (REASONING_RE runs first).
const TICKER_ECOSYSTEM_RE =
  /\bwhat'?s? (going on|happening) (with|on)\b|\bwhat'?s? the (word|story|deal|latest) (with|on)\b|\bany (info|news|flow|activity) on\b|\banything (on|about)\b/i;

/** Questions with these shapes need REASONING, not lookup — always Claude. */
const REASONING_RE =
  /\b(why|explain|compare|versus|vs\.?|should i|would you|what if|predict|forecast|think|opinion|strategy|teach|how do(es)? .{0,20}work)\b/i;

/** A known ticker (curated whitelist) or an explicit $-prefixed symbol only —
 *  never "any capitalized 1-5 letter token," which mis-pins words like CALLS/
 *  HOLD/SETUP/BULL as tickers (the exact bug LARGO-9 fixed elsewhere; reusing
 *  the same KNOWN_TICKERS whitelist here instead of re-deriving a weaker check). */
function extractKnownTicker(question: string): string | null {
  const matches = question.toUpperCase().match(/\$?\b[A-Z]{1,5}\b/g) ?? [];
  for (const m of matches) {
    const hadDollar = m.startsWith("$");
    const cand = m.replace(/^\$/, "");
    if (hadDollar || KNOWN_TICKERS.has(cand)) return cand;
  }
  return null;
}

/**
 * Classify a question for deterministic answering. `ledgerTickers` = tickers on
 * today's 0DTE ledger (play-state questions only route for names we actually
 * track — anything else is a general ticker question and belongs to Claude).
 */
export function classifyBieIntent(question: string, ledgerTickers: Set<string>): BieRoute | null {
  const q = question.trim();
  // Length guard: long/compound questions carry nuance a lookup can't honor.
  if (q.length > 160 || q.split(/[.?!]/).filter((s) => s.trim()).length > 2) return null;
  if (REASONING_RE.test(q)) return null;

  if (ZERODTE_RE.test(q)) return { intent: "zerodte_plays", ticker: null };

  // Ticker play-state: a ledger name + a state-flavored ask.
  const caps = q.toUpperCase().match(/\$?\b[A-Z]{1,5}\b/g) ?? [];
  const hit = caps.map((c) => c.replace(/^\$/, "")).find((c) => ledgerTickers.has(c));
  if (hit && PLAY_STATE_RE.test(q)) return { intent: "ticker_play_state", ticker: hit };

  if (SPX_STRUCTURE_RE.test(q)) return { intent: "spx_structure", ticker: "SPX" };
  if (MARKET_CONTEXT_RE.test(q)) return { intent: "market_context", ticker: null };

  // Any known ticker (not just today's ledger) + an open-ended "what's going
  // on" ask — routes to the same cross-instrument snapshot get_ecosystem_context
  // already gives Claude as a tool, just without the LLM round trip.
  if (TICKER_ECOSYSTEM_RE.test(q)) {
    const ticker = extractKnownTicker(q);
    if (ticker) return { intent: "ticker_ecosystem", ticker };
  }

  return null;
}

/** Normalizes the router's decision into a queryable "bucket" for the
 *  bie_interactions ledger (task #103, groundwork for #112's self-eval loop):
 *  the real intent name when the router matched deterministically, or the
 *  explicit "claude_fallback" sentinel when the question fell through to
 *  Claude. Exported + pure so the null→sentinel mapping is unit-tested
 *  directly, without spinning up a full Largo turn. */
export function bieIntentBucket(intent: BieIntent | null): string {
  return intent ?? "claude_fallback";
}

/** Static follow-up chips per intent — no Haiku call on the router path. */
export function bieFollowups(intent: BieIntent): string[] {
  switch (intent) {
    case "zerodte_plays":
      return ["Why was the top play picked?", "What's the SPX setup right now?", "Any fresh finds on the radar?"];
    case "ticker_play_state":
      return ["Show all of today's plays", "What would invalidate this play?", "What's the SPX setup right now?"];
    case "spx_structure":
      return ["How are today's plays doing?", "Where are dealers positioned?", "Is this flow real or noise?"];
    case "market_context":
      return ["What's the SPX setup right now?", "How are today's plays doing?", "Any unusual flow right now?"];
    case "ticker_ecosystem":
      return ["Is that confirmed by Night Hawk too?", "How are today's plays doing?", "What's the SPX setup right now?"];
  }
}
