// BLACKOUT Intelligence Engine — Layer 3 router (pure classification half).
// The router answers member questions DETERMINISTICALLY when the question maps
// onto data the platform already computes — no LLM call, no latency, no cost,
// and zero hallucination risk, because the answer is composed from the same
// source-of-truth readers every dashboard uses. Anything ambiguous falls through
// to Claude (the general-reasoning fallback). Conservative by design: a missed
// route costs one Claude call; a wrong route costs trust. When unsure → null.

export type BieIntent =
  | "zerodte_plays" // "how are today's plays doing" / the 0DTE board
  | "ticker_play_state" // "how's the NVDA play" — a name on today's ledger
  | "spx_structure" // "SPX levels / walls / gamma flip"
  | "market_context"; // "what's the market doing right now"

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

/** Questions with these shapes need REASONING, not lookup — always Claude. */
const REASONING_RE =
  /\b(why|explain|compare|versus|vs\.?|should i|would you|what if|predict|forecast|think|opinion|strategy|teach|how do(es)? .{0,20}work)\b/i;

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
  }
}
