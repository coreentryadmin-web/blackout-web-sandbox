// BLACKOUT Intelligence Engine — Layer 3 router (pure classification half).
// The router answers member questions DETERMINISTICALLY when the question maps
// onto data the platform already computes — no LLM call, no latency, no cost,
// and zero hallucination risk, because the answer is composed from the same
// source-of-truth readers every dashboard uses. Anything ambiguous falls through
// to Claude (the general-reasoning fallback). Conservative by design: a missed
// route costs one Claude call; a wrong route costs trust. When unsure → null.

import { KNOWN_TICKERS } from "@/lib/largo/question-intent";
import { lookupGlossary } from "./glossary";

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
  | "ticker_compare"
  | "vector_read"
  | "concept_read"
  | "universal_lookup"
  | "verdict"
  | "compound_lookup"
  | "system_diagnostic";

export type BieRoute = {
  intent: BieIntent;
  ticker: string | null;
  /** Second ticker for compare intent. */
  ticker_b?: string | null;
  /** DTE horizon for vector_read (0dte/weekly/monthly/all); ignored by other intents. */
  horizon?: string | null;
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

// Cross-tool VERDICT synthesis (task #59) — the flagship "grade this" question. composeVerdict fans
// out to the RELEVANT engines (dealer gamma + flow always; earnings/fundamentals for a single-name
// hold; macro/breadth for an index/market read) and synthesizes ONE structured envelope with an
// honest confidence + invalidation. Fires on EXPLICIT verdict language, the grading shape
// ("is SPX 7500 0DTE good today", "is 7500 a good play"), an imperative hold-into-event
// ("hold NVDA into earnings"), or a market risk-on/off read.
//
// It deliberately does NOT fire on a "should I …" question — that lighter shape stays on the
// ticker_advice path (both "Should I buy NVDA calls into earnings?" and "Should I hold my TSLA play
// into the close?" are tested there; verdict is the deeper, explicitly-requested synthesis, not a
// hijack of every advice question).
const VERDICT_EXPLICIT_RE =
  /\b(verdict|the call|final call|bottom line|give me (a|the|your) (call|read|verdict|take|grade)|grade (this|the|it|my)\b)\b/i;
const VERDICT_GRADE_RE =
  /\bis\b[^?]{0,48}\b(a\s+)?(good|solid|smart|worth it|worth taking)\b(?:[^?]{0,24}\b(play|trade|idea|entry|setup|buy|call|long|short)\b)?/i;
const VERDICT_HOLD_RE =
  /\b(hold|holding|keep|keeping)\b[^?]{0,30}\b(into|through|over)\s+(earnings|the\s+(print|report|close|open)|the\s+weekend|overnight|the\s+event)\b/i;
const VERDICT_MARKET_RE = /\bis\s+(the\s+market|it)\s+risk[- ]?(on|off)\b/i;

/** True when the question is an explicit cross-tool verdict/grade ask (task #59). "should I …" is
 *  excluded on purpose (stays ticker_advice), as is "hold my … play …" (that's a play-state ask). */
function isVerdictQuestion(q: string): boolean {
  if (/\bshould i\b/i.test(q)) return false; // "should I …" → ticker_advice (tested, preserved)
  if (/\bmy\b[^?]{0,20}\bplay\b/i.test(q)) return false; // "hold my TSLA play …" → play-state advice
  return (
    VERDICT_EXPLICIT_RE.test(q) ||
    VERDICT_MARKET_RE.test(q) ||
    VERDICT_HOLD_RE.test(q) ||
    VERDICT_GRADE_RE.test(q)
  );
}

// Vector desk read — the deterministic Largo-BIE path for Vector questions (zero Claude cost).
// Fires on an explicit "vector" product mention, or on a Vector-surface concept asked about a
// specific ticker (walls / gamma flip / magnet / beads / fadeness / expected move / max pain).
const VECTOR_RE = /\bvector\b/i;
// Vector-surface concepts — walls / flip / regime / magnet, the DTE + timeframe controls, the
// chart technicals, and the bead/VEX/dark-pool lenses. Broad on purpose: a ticker + any of these
// is a Vector desk question, which the deterministic Vector read answers in full.
const VECTOR_STRUCTURE_RE =
  /\b(gamma\s*(flip|wall|walls|magnet|regime)|call wall|put wall|gamma[- ]?walls?|walls?|expected move|max ?pain|wall integrity|beads?|fad(?:e|ing|eness)|build(?:ing)?|forming|dissolv\w*|stacking|dealer walls?|dte walls?|dtes|expir(?:y|ies)|weekly|monthly|timeframe|technicals?|vwap|ema|rsi|macd|market structure|vex|vanna|dark[- ]?pool|magnet|(?:1|3|5|15|30)\s?m|(?:1|2|4)\s?h)\b/i;

// Concept/definition questions — "what is GEX", "define the gamma flip", "explain a king node",
// "what does Night Hawk do". These are answered from the deterministic glossary (composeConceptRead
// → lookupGlossary), NOT the live desk. Gated below so a question that names a ticker or asks for a
// LIVE value ("what is NVDA's flip", "what is the market doing") is NOT stolen — those stay numeric.
// Definitional lead-ins only (NOT "what do you think" — that's opinion/reasoning, kept out on
// purpose so it still falls through to Claude).
const CONCEPT_RE =
  /\b(what(?:'|’)?s|what\s+is|what\s+are|whats|define|definition of|explain|what does|meaning of|tell me about|describe)\b/i;
/** Live/status hints — a "what's X doing / the setup / the play" is a live read, not a definition.
 *  Deliberately status VERBS + product-state nouns, NOT bare "market" (so "what is market structure"
 *  stays a concept). */
const CONCEPT_LIVE_HINT_RE =
  /\b(doing|happening|going on|right now|look(ing)? like|the setup|the play|the trade|the bias|the read|tonight|tonight's|today's|latest|current|this week|edition)\b/i;
/** Teach/opinion/reasoning shapes that belong with Claude, not a glossary lookup. */
const CONCEPT_TEACH_EXCLUDE_RE =
  /\bin general\b|\bshould i\b|\bwould you\b|\bthink\b|\bworried\b|\bopinion\b|\bpredict\b|\bforecast\b|\bhow\b[^?]{0,40}\bwork/i;

/** True when a question is a plain definitional ask — no ticker, no live-status hint, not a
 *  teach/opinion question. Unknown TERMS still count (composeConceptRead answers them honestly and
 *  gap-logs); only ticker/live/teach shapes are filtered out here. ALSO catches a BARE glossary term
 *  ("GEX", "max pain", "king node") — the terse-barrage shape a compound split produces — even
 *  without a "what is" lead-in, gated to a short phrase that actually resolves to a definition. */
function isConceptQuestion(q: string): boolean {
  if (extractKnownTicker(q) != null) return false; // a named ticker → live read, not a definition
  if (CONCEPT_LIVE_HINT_RE.test(q)) return false; // "what is the market doing" → live
  if (CONCEPT_TEACH_EXCLUDE_RE.test(q)) return false; // "explain how gamma hedging works" → Claude
  if (CONCEPT_RE.test(q)) return true; // definitional lead-in ("what is X", "define X", …)
  // Bare glossary term with no lead-in (terse barrage: "GEX", "max pain", "king node"): concept
  // ONLY when it's a short phrase that resolves to a real definition — never a broad steal. The
  // ZERODTE exclusion keeps a live "0DTE board" query (which the 0dte alias would otherwise match)
  // on the zerodte_plays path, not the definition.
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && !ZERODTE_RE.test(q) && lookupGlossary(q) != null) return true;
  return false;
}

// Universal lookup — "pull / look up / fetch / show me X from Y", where the question names an
// explicit internal endpoint (/api/…) or a provider (polygon / unusual whales / uw) + a path. The
// deterministic composeUniversal resolves it through the GOVERNED readers (call_internal_api /
// get_uw / get_polygon). A verbing lead-in alone isn't enough — it must reference a path/source, so
// this never steals a plain "show me the SPX setup" (that has no path/provider).
const UNIVERSAL_VERB_RE = /\b(look\s?up|pull|fetch|grab|show me|get me|get|read|query|hit)\b/i;
const UNIVERSAL_SOURCE_RE = /(\/api\/[\w\-\/]+|\/v[0-9x]+\/[\w\-\/.]+|\bfrom (the )?(polygon|massive|unusual ?whales|uw|internal api|api)\b)/i;

function isUniversalLookup(q: string): boolean {
  return UNIVERSAL_VERB_RE.test(q) && UNIVERSAL_SOURCE_RE.test(q);
}

// Self-diagnosis (task #56) — "why isn't NVDA GEX / MSFT beads forming", "is the flow pipeline
// healthy", "what's failing right now". Answered from REAL ops signals (composeDiagnostic), NOT
// Claude — so this MUST be classified BEFORE REASONING_RE, or the "why" bails to the LLM.
const DIAGNOSTIC_RE =
  /\b(why (is|isn't|are|aren't|won't|not)\b[^?]*\b(form|forming|showing|updating|building|empty|blank|missing|work(ing)?|load(ing)?|render(ing)?|populat)|why (can't|cant|do(n't| not))\b[^?]*\b(see|show|get|find)\b|is the .{0,30}(pipeline|feed|recorder|cron|flow|gex|data) (healthy|up|down|working|stale|broken)|what('| i)?s (failing|broken|wrong|stale|down)|(pipeline|recorder|feed) (health|status|down|stale|broken))\b/i;

function isDiagnosticQuestion(q: string): boolean {
  return DIAGNOSTIC_RE.test(q);
}

/** Vector DTE horizon named in the question, defaulting to "all" (whole-chain view). */
function extractHorizon(q: string): string {
  if (/\b0\s*dte\b/i.test(q)) return "0dte";
  if (/\bweekl/i.test(q)) return "weekly";
  if (/\bmonthl/i.test(q)) return "monthly";
  return "all";
}

/** A structure figure (flip/walls/max pain/levels/magnet/expected move) that is HORIZON-SPECIFIC. */
const SPX_HORIZON_STRUCTURE_RE =
  /\b(flip|call wall|put wall|walls?|max ?pain|gamma|structure|levels?|magnet|expected move)\b/i;

/**
 * True for a weekly/monthly SPX structure ask ("SPX weekly flip", "SPX monthly walls / max pain").
 * The SPX Slayer desk (and the BIE SPX composers that read it) serve fetchGexHeatmap's ~8-nearest-
 * expiry AGGREGATE for EVERY horizon — it has no dte param — so it would report the 0DTE/aggregate
 * flip as the "weekly"/"monthly" number (live scan: aggregate 7,554 leaked as weekly, when the true
 * weekly flip was 7,622 and monthly 7,647). Vector re-scopes per-DTE correctly, so these route to the
 * horizon-scoped Vector engine instead of the desk. A plain "SPX weekly setup" (no structure figure)
 * is NOT caught — only the specific per-horizon numbers that would otherwise leak.
 */
function isSpxHorizonScopedStructureQuestion(q: string, horizon: string): boolean {
  if (horizon !== "weekly" && horizon !== "monthly") return false;
  if (!/\b(spx|spxw|s&p|es)\b/i.test(q)) return false;
  return SPX_HORIZON_STRUCTURE_RE.test(q);
}

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

  // Definitional/concept question → the glossary read. Placed FIRST (even before the explicit
  // "vector" branch) so "what is Vector" / "what is GEX" / "what does Night Hawk do" resolve to a
  // DEFINITION, while a live "vector setup on NVDA" (has a ticker) still routes to vector_read below.
  if (isConceptQuestion(q)) return { intent: "concept_read", ticker: null };

  // "pull/look up X from <internal path | provider>" → the governed universal reader. Only fires
  // when a path or provider is explicitly named, so a plain "show me the SPX setup" isn't stolen.
  if (isUniversalLookup(q)) return { intent: "universal_lookup", ticker: extractKnownTicker(q) };

  // "why isn't X forming / is the pipeline healthy / what's failing" → self-diagnosis from real ops
  // signals. MUST be before REASONING_RE (and before the vector branch, whose "forming" overlaps),
  // or "why" bails to Claude / the surface gets read as a normal Vector question.
  if (isDiagnosticQuestion(q)) return { intent: "system_diagnostic", ticker: extractKnownTicker(q) };

  // Explicit "vector" mention → the deterministic Vector desk read, for ANY ticker (incl. SPX on
  // Vector). Placed first so the Vector product wins over the SPX-Sniper branches when named.
  if (VECTOR_RE.test(q)) {
    return { intent: "vector_read", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
  }

  if (SPX_WHY_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (SPX_EXPLAIN_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (SPX_INVALIDATION_RE.test(q)) return { intent: "spx_invalidation", ticker: "SPX" };

  // Cross-tool verdict synthesis — placed before COMPARE/ADVICE so an explicit "grade this /
  // is X good / hold X into earnings" gets the deep multi-engine envelope, while "should I …"
  // (excluded in isVerdictQuestion) still falls through to the lighter ticker_advice path.
  if (isVerdictQuestion(q)) return { intent: "verdict", ticker: extractKnownTicker(q) };

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

  // A Vector-surface concept (walls/gamma flip/magnet/expected move/beads/…) asked about a
  // specific NON-SPX ticker → Vector desk read. SPX keeps its own richer Sniper-desk routing
  // below (spx_structure / spx_desk_read); a bare "gamma flip on NVDA" has no SPX home otherwise.
  if (VECTOR_STRUCTURE_RE.test(q)) {
    const ticker = extractKnownTicker(q);
    if (ticker && ticker !== "SPX") {
      return { intent: "vector_read", ticker, horizon: extractHorizon(q) };
    }
  }

  if (REASONING_RE.test(q)) return null;

  if (ZERODTE_RE.test(q)) return { intent: "zerodte_plays", ticker: null };

  const caps = q.toUpperCase().match(/\$?\b[A-Z]{1,5}\b/g) ?? [];
  const hit = caps.map((c) => c.replace(/^\$/, "")).find((c) => ledgerTickers.has(c));
  if (hit && PLAY_STATE_RE.test(q)) return { intent: "ticker_play_state", ticker: hit };

  // HORIZON-SCOPE guard — a weekly/monthly SPX structure ask must NOT be answered by the SPX Slayer
  // desk (which serves the 0DTE/nearest-expiry aggregate for every horizon and would present a 0DTE
  // number as the monthly). Route to the per-DTE-correct Vector engine. Placed AFTER the why/explain
  // SPX branches (those are reasoning, handled above) but BEFORE the plain SPX structure/desk reads.
  {
    const horizon = extractHorizon(q);
    if (isSpxHorizonScopedStructureQuestion(q, horizon)) {
      return { intent: "vector_read", ticker: "SPX", horizon };
    }
  }

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
  if (isConceptQuestion(q)) return { intent: "concept_read", ticker: null };
  if (isUniversalLookup(q)) return { intent: "universal_lookup", ticker: extractKnownTicker(q) };
  if (isDiagnosticQuestion(q)) return { intent: "system_diagnostic", ticker: extractKnownTicker(q) };
  if (VECTOR_RE.test(q)) {
    return { intent: "vector_read", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
  }
  if (ZERODTE_RE.test(q)) return { intent: "zerodte_plays", ticker: null };
  if (SPX_INVALIDATION_RE.test(q)) return { intent: "spx_invalidation", ticker: "SPX" };
  if (isVerdictQuestion(q)) return { intent: "verdict", ticker: extractKnownTicker(q) };
  // Same horizon-scope guard as the primary classifier — a weekly/monthly SPX structure figure must
  // come from the per-DTE Vector engine, never the aggregate SPX desk fallback.
  {
    const horizon = extractHorizon(q);
    if (isSpxHorizonScopedStructureQuestion(q, horizon)) {
      return { intent: "vector_read", ticker: "SPX", horizon };
    }
  }
  if (SPX_STRUCTURE_RE.test(q) || SPX_DESK_READ_RE.test(q) || SPX_WHY_RE.test(q) || SPX_EXPLAIN_RE.test(q)) {
    return { intent: "spx_desk_read", ticker: "SPX" };
  }
  if (FLOW_TAPE_RE.test(q)) return { intent: "flow_tape", ticker: extractKnownTicker(q) };
  {
    const vTicker = extractKnownTicker(q);
    if (VECTOR_STRUCTURE_RE.test(q) && vTicker && vTicker !== "SPX") {
      return { intent: "vector_read", ticker: vTicker, horizon: extractHorizon(q) };
    }
  }
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
    case "vector_read":
      return [
        "Which walls are building vs fading?",
        "What's the play and where does it invalidate?",
        "Show the 0DTE horizon instead",
      ];
    case "concept_read":
      return ["What is a King node?", "What is the gamma flip?", "What does Night Hawk do?"];
    case "universal_lookup":
      return ["Pull the GEX positioning for SPY", "Show me the platform snapshot", "What is GEX?"];
    case "verdict":
      return ["What would flip this read?", "Show the flow tape", "What's the SPX setup right now?"];
    case "compound_lookup":
      return ["Ask a single question for the full read", "What's the SPX setup right now?", "What is a King node?"];
    case "system_diagnostic":
      return ["Is the flow pipeline healthy?", "Why isn't SPX GEX updating?", "What's the SPX setup right now?"];
  }
}
