// BLACKOUT Intelligence Engine — Layer 3 router (pure classification half).
// The router answers member questions DETERMINISTICALLY when the question maps
// onto data the platform already computes — no LLM call, no latency, no cost,
// and zero hallucination risk, because the answer is composed from the same
// source-of-truth readers every dashboard uses. Anything ambiguous falls through
// to Claude (the general-reasoning fallback). Conservative by design: a missed
// route costs one Claude call; a wrong route costs trust. When unsure → null.

import { KNOWN_TICKERS } from "@/lib/largo/question-intent";
import { lookupGlossary } from "./glossary";
import { namesUnsupportedHorizon } from "./vector-read-fallback";
import { isScenarioQuestion } from "./scenario-read";
import { isOpsReadQuestion } from "./ops-read-core";

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
  | "system_diagnostic"
  | "ops_read"
  | "cortex_read"
  | "nighthawk_edition"
  | "scenario"
  | "cross_check"
  | "off_topic";

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

// The reverse-order (token-then-SPX) second alternative gains bare `flip` / `0dte` / `gamma` so the
// terse "flip spx" / "0dte spx" shorthand lands deterministically on the SPX structure desk instead
// of falling through to null → Claude (the first alt already covers the natural "spx flip" order).
const SPX_STRUCTURE_RE =
  /\b(spx|es|s&p)\b[^?]*\b(levels?|structure|walls?|gamma( flip)?|flip|max pain|king node|support|resistance)\b|\b(levels?|structure|walls?|gamma flip|max pain|flip|0\s*dte|gamma)\b[^?]*\bspx\b/i;

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
/** Comparative cues that make a TWO-ticker question a compare even without a compare/vs keyword —
 *  "is SPX or NVDA closer to its flip?", "which of SPY or QQQ is stronger?". Deliberately weak on
 *  its own: the compare branch additionally requires extractCompareTickers to find two DISTINCT
 *  known tickers, so these common words can never hijack a single-ticker or ticker-less question. */
const COMPARATIVE_CUE_RE =
  /\b(closer|closest|nearer|nearest|farther|further|which|more|less|higher|lower|stronger|weaker|better|worse)\b/i;

// SELF-vs-LEVEL (#48) — ONE ticker measured against one of ITS OWN structure levels ("SPX vs its
// gamma flip", "NVDA against its call wall", "where's SPY relative to the flip"). This is a spot-vs-
// level structure question, NOT a two-name compare (extractCompareTickers finds only one ticker). The
// compound decomposer produces exactly this fragment; without a home it hit REASONING_RE ("vs") and
// bailed to null, so an ANSWERABLE part was dropped as "unavailable". A single ticker + a "vs/against/
// relative-to ITS <structure level>" cue routes to the ticker's structure read (SPX → the Sniper
// structure desk, others → Vector) before REASONING_RE can bail.
const SELF_VS_LEVEL_RE =
  /\b(?:vs\.?|versus|against|relative to|compared? to|above or below)\b[^?]{0,28}\b(?:its|it'?s|the)\b[^?]{0,18}\b(?:gamma\s*)?(?:flip|call wall|put wall|walls?|max ?pain|magnet|vwap)\b/i;

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

// Verdict RECALL (task #83) — "why did you say 7500 was good this morning", "does that verdict still
// hold?". These reference a PRIOR verdict and are answered from the pinned case-law record (re-checking
// its falsifiers against the live read), never re-fabricated. Two signals: a backreference to something
// I SAID/CALLED, or a "still valid/holds" ask that explicitly names a verdict/call/read. Deliberately
// tight — "why did we PULL/PICK/SKIP X" (Night Hawk/Cortex decision reads) and a play-state "is my
// play still good" are excluded so this only steals genuine recall-of-my-verdict asks.
const RECALL_BACKREF_RE =
  /\b(you (said|called|graded|rated)|why did (you|largo|we) (say|call|grade|rate)|(your|the|that|this)\s+(earlier|previous|prior|morning|last)\s+(verdict|call|read|take|grade))\b/i;
const RECALL_VALIDITY_RE =
  /\b(still\s+(valid|hold|holds|holding|stand|standing|good)|does\s+(that|it|this|the read)\s+still\s+(hold|stand|apply))\b/i;

/** True when the question is a recall of a previously-rendered verdict (task #83). */
export function isVerdictRecallQuestion(q: string): boolean {
  if (/\bmy\b[^?]{0,20}\bplay\b/i.test(q)) return false; // "is my TSLA play still good" → play-state
  if (/\b(pull|pulled|pick|picked|skip|skipp|commit|committed)\b/i.test(q)) return false; // NH/Cortex decision reads
  if (RECALL_BACKREF_RE.test(q)) return true;
  return RECALL_VALIDITY_RE.test(q) && /\b(verdict|call|read|take|grade)\b/i.test(q);
}

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
// NOTE the BARE `flip` / `gamma` / `0dte` tokens added here (2026-07-14 RTH terse-routing fix): the
// desk-shorthand shape a member actually types is "flip nvda" / "gamma qqq" / "0dte spy" — a bare
// vector token + a ticker. Before this the alternation only matched the two-word "gamma flip" /
// "gamma wall", so a bare "flip nvda" fell THROUGH every non-SPX branch and hit the SPX-desk
// catch-all (classifyBieStagingFallback ~L711 `/…|flip)/ → force SPX`), which discarded the extracted
// NVDA and served the SPX desk dump — members got SPX numbers for an NVDA question. "spy walls"
// already worked because bare "walls?" was here; these three tokens make the flip/gamma/0dte
// shorthand mirror it. This regex is consumed ONLY by the two `ticker && ticker !== "SPX"` branches
// below, so broadening it can only re-home a NON-SPX ticker to its own vector_read (never SPX).
const VECTOR_STRUCTURE_RE =
  /\b(gamma\s*(flip|wall|walls|magnet|regime)|gamma|flip|0\s*dte|zero\s*dte|zerodte|call wall|put wall|gamma[- ]?walls?|walls?|expected move|max ?pain|wall integrity|beads?|fad(?:e|ing|eness)|build(?:ing)?|forming|dissolv\w*|stacking|dealer walls?|dte walls?|dtes|expir(?:y|ies)|weekly|monthly|timeframe|technicals?|vwap|ema|rsi|macd|market structure|vex|vanna|dark[- ]?pool|magnet|(?:1|3|5|15|30)\s?m|(?:1|2|4)\s?h)\b/i;

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
  /\b(doing|happening|going on|right now|look(ing)? like|the setup|the play|the trade|the bias|the read|tonight|tonight's|today's|tomorrow|tomorrow's|latest|current|this week|edition|playbook)\b/i;
/** Teach/opinion/reasoning shapes that belong with Claude, not a glossary lookup. */
const CONCEPT_TEACH_EXCLUDE_RE =
  /\bin general\b|\bshould i\b|\bwould you\b|\bthink\b|\bworried\b|\bopinion\b|\bpredict\b|\bforecast\b|\bhow\b[^?]{0,40}\bwork/i;

// LIVE-REGIME ask (#45) — "market regime?", "what's the regime", "what regime are we in", "current
// regime". These want the LIVE regime read (composeMarketContext surfaces the HELIX regime detector),
// NOT the glossary DEFINITION of what a gamma regime IS. The bare "market regime" was resolving to
// the glossary because it's a ≤4-word phrase that lookupGlossary matches. The DEFINITIONAL ask ("what
// is [a/the] gamma regime", "define regime", "what does regime mean") is explicitly excluded so it
// keeps its concept_read home — the discriminator is the word "gamma" before "regime" (or a
// define/mean lead-in), which marks the CONCEPT rather than the current live state.
const REGIME_LIVE_RE =
  /\b(?:market\s+regime|(?:what'?s?|what\s+is)\s+(?:the\s+)?(?:current\s+|live\s+)?regime|(?:the\s+)?(?:current|live)\s+regime|regime\s+(?:right\s+now|now|today)|what\s+regime\s+are\s+we\s+in)\b/i;

/** True for a LIVE-regime ask that must route to the live market read, not the glossary definition. */
function isLiveRegimeQuestion(q: string): boolean {
  if (/\bgamma\s+regime\b/i.test(q)) return false; // "what is gamma regime" → concept (definition)
  if (/\bdefine\b|\bmeaning of\b|\bwhat\s+does\b[^?]{0,20}\bregime\b[^?]{0,10}\bmean\b/i.test(q)) return false;
  return REGIME_LIVE_RE.test(q) || /^\s*regime\??\s*$/i.test(q);
}

// CLEARLY-OFF-TOPIC domains (#41) — cooking / food / weather / poetry / general chat. A "what's a
// recipe for lasagna" carries a definitional lead-in ("what's a…") so it hit the concept catch-all
// and got a glossary "logged it to be added" instead of the honest off_topic scope card. This
// denylist forces the off_topic path AHEAD of the concept catch-all — but ONLY when the question ALSO
// has zero market subject, so an unknown-but-plausibly-market term ("the flongle indicator") still
// routes to concept_read for the honest gap-log (that boundary is asserted in router.test.ts).
const OFF_TOPIC_DOMAIN_RE =
  /\b(recipe|recipes|lasagna|pizza|pasta|cook|cooking|bake|baking|breakfast|lunch|dinner|sandwich|salad|dessert|weather|forecast\s+for\s+the\s+weather|rain|snow|poem|poetry|haiku|sonnet|joke|riddle|lyrics|horoscope|astrology|zodiac|dating|girlfriend|boyfriend)\b/i;

/** True when a question is a plain definitional ask — no ticker, no live-status hint, not a
 *  teach/opinion question. Unknown TERMS still count (composeConceptRead answers them honestly and
 *  gap-logs); only ticker/live/teach shapes are filtered out here. ALSO catches a BARE glossary term
 *  ("GEX", "max pain", "king node") — the terse-barrage shape a compound split produces — even
 *  without a "what is" lead-in, gated to a short phrase that actually resolves to a definition. */
function isConceptQuestion(q: string): boolean {
  if (isLiveRegimeQuestion(q)) return false; // "market regime?" → live regime read, not the definition (#45)
  if (OFF_TOPIC_DOMAIN_RE.test(q) && !hasMarketSubject(q)) return false; // "recipe for lasagna" → off_topic, not glossary (#41)
  if (NH_RECORD_ASK_RE.test(q)) return false; // "our track record" → the live record read, not a definition
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

// Imperative self-test shorthand — "run a self-diagnosis", "self-diagnostic", "run diagnostics",
// "diagnose yourself", "system check". These name the diagnostic engine directly rather than
// describing a broken surface, so DIAGNOSTIC_RE (which keys on "why isn't X forming" / "is the
// pipeline healthy") missed them and they bailed to the generic Largo identity response (#34).
const DIAGNOSTIC_SELF_RE =
  /\b(self[-\s]?diagnos(?:is|tic|e)|run\s+(?:a\s+)?(?:self[-\s]?)?diagnos(?:is|tics?)|diagnos(?:e|tic)\s+(?:yourself|the\s+system|your\s+system)|system\s+(?:self[-\s]?)?(?:diagnos\w*|health\s*check)|run\s+(?:a\s+)?system\s+check)\b/i;

function isDiagnosticQuestion(q: string): boolean {
  return DIAGNOSTIC_RE.test(q) || DIAGNOSTIC_SELF_RE.test(q);
}

// Cortex read (PR-H) — the deterministic "explain the 0DTE decision" path. Two shapes:
//  1. an explicit "cortex" mention ("what does cortex say about NVDA", "cortex verdict
//     on NVDA", terse "cortex nvda") — any cortex ask that survived the concept branch
//     (a bare/definitional "what is cortex" resolves to the glossary FIRST, so only
//     live/subject-bearing cortex questions reach this);
//  2. a decision-WHY ("why did we commit NVDA", "why was TSLA skipped", "why did we
//     exit MU", "why was the top play picked") — answered from the PINNED records
//     (entry_context.cortex / exit, the rejection log), live composition otherwise.
// MUST be classified before REASONING_RE (the "why" would bail to Claude) and before
// the verdict branch ("cortex verdict on X" contains the verdict trigger word).
const CORTEX_TERM_RE = /\bcortex\b/i;
// The "take" verb is negative-lookahead-guarded against "take a hit / take the dive"
// phrasings — those are market-why questions, not decision-record questions.
const CORTEX_DECISION_RE =
  /\bwhy\b[^?]{0,80}\b(was|were|did|didn'?t|wasn'?t)\b[^?]{0,80}\b(commit(?:ted)?|skip(?:ped)?|veto(?:ed|'d)?|blocked|passed(?: on| over)?|pass on|siz(?:e|ed)|picked|exit(?:ed)?|tak(?:e|en)(?!\s+(?:a|an|the|it)\b))\b/i;

function isCortexQuestion(q: string): boolean {
  return CORTEX_TERM_RE.test(q) || CORTEX_DECISION_RE.test(q);
}

// Night Hawk EDITION read (PR-N9) — the deterministic "tomorrow's plays" path. Shapes:
//  1. edition asks: "tomorrow's plays", "tonight's playbook", "what's in the edition",
//     "what is tonight's Night Hawk edition", terse "playbook" / "nh";
//  2. pick-WHY: "why was CSX picked (tonight)?", "why was the pick pulled?", "was AMD
//     pulled?" — answered from the PINNED records (#331: publish_context, the persisted
//     morning_verdict, the one-way pulled latch), never reconstructed;
//  3. terse "nh <ticker>" — that pick's full story;
//  4. morning-check asks: "what did the morning check see?".
// Placement: AFTER concept/diagnostic (a definitional "what is a pulled play" stays a
// glossary read; "why isn't the edition loading" stays a diagnostic) and BEFORE the
// cortex branch — "why was <ticker> picked/pulled" is an OVERNIGHT decision question,
// while the ticker-less "why was the top play picked" (no NH marker, no ticker subject)
// deliberately falls through to the 0DTE cortex_read exactly as before (#327's tested
// shape). Also before REASONING_RE, or the "why" would bail to Claude.
const NIGHTHAWK_TERM_RE = /\bnight\s?hawk\b/i;
const NH_EDITION_HINT_RE =
  /\b(edition|playbook|plays?|picks?|picked|pulled|morning\s+(check|confirm(?:ation)?|verdict))\b/i;
const NH_OVERNIGHT_MARKER_RE = /\b(tonight'?s?|tomorrow'?s?|overnight|edition|playbook|night\s?hawk)\b/i;
const NH_TOMORROW_PLAYS_RE = /\b(tomorrow'?s|tonight'?s)\s+(plays?|picks?|playbook|edition|setups?)\b/i;
const NH_IN_EDITION_RE = /\bwhat'?s?\s+(?:is\s+)?in\s+the\s+(edition|playbook)\b/i;
const NH_TERSE_TICKER_RE = /^(?:nh|night\s?hawk)\s+\$?([a-z]{1,5})\??\s*$/i;
const NH_TERSE_EDITION_RE = /^(?:nh|playbook|the\s+playbook|the\s+edition|night\s?hawk\s+edition)\??\s*$/i;
// "pulled" only counts as the LATCH verb when not followed by a direction word —
// "price got pulled back / pulled lower" is tape talk, not the morning-confirm latch.
const NH_PULLED_WORD = /\bpulled\b(?!\s+(?:back|lower|higher|down|up|toward|into|in)\b)/i;
const NH_PICK_WHY_RE =
  /\bwhy\b[^?]{0,80}\b(?:was|were|did|didn'?t|wasn'?t|is|isn'?t)\b[^?]{0,80}\b(?:picked|pulled(?!\s+(?:back|lower|higher|down|up|toward|into|in)\b)|chosen|selected)\b/i;
// The word directly before picked/pulled ("why was CSX picked") — edition tickers are
// often outside KNOWN_TICKERS (CSX, DELL, PANW…), so the subject capture is the primary
// ticker source and extractKnownTicker is the fallback.
const NH_PICK_SUBJECT_RE =
  /\b(?:was|were|is)\s+(?:the\s+)?\$?([A-Za-z]{1,5})\s+(?:play\s+|pick\s+)?(?:picked|pulled|chosen|selected)\b/i;
const NH_PICK_STOPWORDS = new Set(["THE", "IT", "WE", "THEY", "THIS", "THAT", "TOP", "A", "AN", "MY", "OUR", "PLAY", "PICK", "ONE", "PLAYS", "PICKS"]);
// "was X pulled" without a why — pulled is Night Hawk vocabulary (the one-way latch);
// the NH_PULLED_WORD lookahead keeps "pulled back / pulled lower" (price talk) out.
const NH_PULLED_STATE_RE =
  /\b(?:was|were|got|is|why)\b[^?]{0,60}\bpulled\b(?!\s+(?:back|lower|higher|down|up|toward|into|in)\b)/i;
const NH_MORNING_RE = /\bmorning\s+(check|confirm(?:ation)?|verdict)\b/i;
// OVERALL-RECORD ask (PR-L4e-1) — "what is our honest Night Hawk record right now", "our track
// record", "how are the plays doing overall". This is the ACCOUNTABILITY question — the honest
// aggregate win-rate across editions — NOT "why was X picked" (edition, has a ticker) and NOT "how
// did last night do" (the session debrief, NH_DEBRIEF_ASK_RE). Deliberately keyed on explicit
// record vocabulary ("track record" / "our record" / "<nighthawk> record" / "record right now|so
// far|overall" / "plays doing overall") so a plain "today's plays" / "how are today's plays doing"
// (zerodte) is never stolen — those lack the record/overall marker.
export const NH_RECORD_ASK_RE =
  /\b(?:track[-\s]record|our\s+(?:honest\s+)?record|(?:night\s?hawk|nighthawk)\s+record|(?:overall|lifetime|all[-\s]?time)\s+record|record\s+(?:right\s+now|so\s+far|overall|to\s+date)|how\s+are\s+(?:the|our)\s+plays\s+doing\s+overall|plays\s+doing\s+overall)\b/i;

function nighthawkSubjectTicker(q: string): string | null {
  const subj = q.match(NH_PICK_SUBJECT_RE)?.[1]?.toUpperCase() ?? null;
  if (subj && !NH_PICK_STOPWORDS.has(subj)) return subj;
  return extractKnownTicker(q);
}

function nighthawkEditionRoute(q: string): BieRoute | null {
  // "our record" / "track record" / "how are the plays doing overall" → the accountability read
  // (composeNighthawkEditionRead resolves the ticker-less record ask to the OVERALL honest record).
  // First, before the terse-ticker and pick-why branches, so "our record" is never read as a ticker.
  if (NH_RECORD_ASK_RE.test(q)) return { intent: "nighthawk_edition", ticker: null };
  const terse = q.match(NH_TERSE_TICKER_RE);
  if (terse) return { intent: "nighthawk_edition", ticker: terse[1]!.toUpperCase() };
  if (NH_TERSE_EDITION_RE.test(q)) return { intent: "nighthawk_edition", ticker: null };
  if (NH_PICK_WHY_RE.test(q)) {
    const ticker = nighthawkSubjectTicker(q);
    // "picked" needs a ticker subject or an overnight marker, so the ticker-less 0DTE
    // "why was the top play picked" keeps falling through to cortex_read (tested there).
    if (NH_PULLED_WORD.test(q) || ticker != null || NH_OVERNIGHT_MARKER_RE.test(q)) {
      return { intent: "nighthawk_edition", ticker };
    }
  }
  if (NH_PULLED_STATE_RE.test(q)) {
    return { intent: "nighthawk_edition", ticker: nighthawkSubjectTicker(q) };
  }
  if (NH_TOMORROW_PLAYS_RE.test(q) || NH_IN_EDITION_RE.test(q)) {
    return { intent: "nighthawk_edition", ticker: null };
  }
  // "the playbook" / "the edition" (any lead-in) — Night Hawk vocabulary, unless the
  // question is explicitly about an SPX/0DTE surface (those own their desks' terms).
  if (
    /\b(?:the|tonight'?s|tomorrow'?s)\s+(?:playbook|edition)\b/i.test(q) &&
    !/\b(spx|s&p|es|0\s?dte|zero\s?dte|zerodte)\b/i.test(q)
  ) {
    return { intent: "nighthawk_edition", ticker: null };
  }
  if (NIGHTHAWK_TERM_RE.test(q) && NH_EDITION_HINT_RE.test(q)) {
    return { intent: "nighthawk_edition", ticker: extractKnownTicker(q) };
  }
  if (NH_MORNING_RE.test(q)) {
    return { intent: "nighthawk_edition", ticker: extractKnownTicker(q) };
  }
  return null;
}

// SCENARIO what-if (PR-L4c) — "if SPX drops 1%", "what happens if SPY breaks 745", "if we lose the
// flip", "SPX at 7450 scenario", "what if QQQ rips 2%". A DOUBLE gate authorizes the route, so it can
// never steal a static read: (1) an explicit hypothetical TRIGGER (if / what if / suppose / imagine /
// assume / "scenario" / hypothetical), AND (2) a parseShift() that actually pins down a price move
// (percent / points / absolute level / structural "the flip"|"the wall"). A definitional "what is the
// flip" (no trigger, no scopeable shift), a verdict "is SPX 7500 good" (no trigger, "7500" isn't a
// scoped shift), a cortex "why did we commit X" (no trigger) all fail one gate and keep their homes.
// SCENARIO_TRIGGER_RE + the double-gate now live in scenario-read.ts (isScenarioQuestion) so the
// compound decomposer and this router agree on exactly what a scenario question is. Re-exported symbol
// kept in the import above; the local reference below preserves the original inline comment intent.
function scenarioRoute(q: string): BieRoute | null {
  if (!isScenarioQuestion(q)) return null; // needs BOTH a hypothetical trigger AND a scopeable shift
  return { intent: "scenario", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
}

// CROSS-SURFACE cross-check (PR-L4e-4) — "cross-check Vector and the SPX desk: do they agree?",
// "does Vector match the desk on max pain?", "reconcile the desk and Vector". composeCrossCheck reads
// the SAME metric (max pain / gamma flip / regime) from BOTH surfaces and FLAGS a material divergence
// explicitly instead of silently presenting one. Double-gated to avoid stealing a single-surface read:
//   (1) an explicit cross-check/reconcile verb, OR an agreement cue (agree/match/disagree/consistent/
//       line up/conflict/differ) — AND
//   (2) BOTH surfaces named (Vector AND the SPX desk).
// A plain "Vector setup on SPX" (no agreement cue, one surface) or "SPX desk read" is never caught.
const CROSS_CHECK_VERB_RE = /\b(cross[-\s]?check|reconcile)\b/i;
const CROSS_CHECK_AGREE_CUE_RE =
  /\b(agree|agrees|disagree|disagrees|match(?:es|ing)?|consistent|conflict(?:s|ing)?|line\s+up|lines\s+up|differ(?:s|ing)?|discrepan\w*|same\s+(?:read|number|level))\b/i;
const CROSS_CHECK_VECTOR_RE = /\bvector\b/i;
const CROSS_CHECK_DESK_RE = /\b(spx\s*desk|the\s*desk|desk|slayer|sniper|spx)\b/i;

function isCrossCheckQuestion(q: string): boolean {
  const hasVector = CROSS_CHECK_VECTOR_RE.test(q);
  const hasDesk = CROSS_CHECK_DESK_RE.test(q);
  if (!hasVector || !hasDesk) return false; // a cross-check needs TWO named surfaces
  return CROSS_CHECK_VERB_RE.test(q) || CROSS_CHECK_AGREE_CUE_RE.test(q);
}

// OFF-TOPIC scope guard (PR-L4d-1) — the staging BIE-only last-resort must NEVER answer an
// off-topic ask (poem / weather / arithmetic / general chat / prompt-injection) with a market dump.
// hasMarketSubject is the POSITIVE gate: a question is on-topic when it names a ticker, a $-symbol, a
// glossary/concept term, or ANY market/platform vocabulary. Off-topic = none of those present. This
// is deliberately conservative — a terse legit ask ("flip spx", "gex", "nh", a bare ticker) always
// carries a subject, so it is NEVER caught; only a question with zero market/platform subject is.
const MARKET_SUBJECT_RE =
  /\b(spx|spy|es|s&p|qqq|iwm|vix|ndx|nq|dia|market|tape|gamma|gex|vex|dex|charm|vanna|flip|wall|walls|king\s*node|node|max\s*pain|magnet|bead|beads|regime|breadth|dealer|dealers|hedg\w*|dark\s*pool|vwap|ema|rsi|macd|expected\s*move|strike|strikes|calls?|puts?|option|options|earnings|invalidat\w*|setup|bias|trade|trades|trading|position|positioning|record|playbook|edition|pick|picks|plays?|vector|slayer|sniper|desk|cortex|night\s?hawk|nighthawk|0\s*dte|zero\s*dte|zerodte|dte|flow|whale|lotto|scanner|confluence|structure|levels?|support|resistance|expir\w*|weekly|monthly|ticker|stock|equity|chart|nh)\b/i;

function hasMarketSubject(q: string): boolean {
  if (extractKnownTicker(q) != null) return true; // named ticker (spx / nvda / $NVDA …)
  if (/\$[A-Za-z]{1,5}\b/.test(q)) return true; // explicit $-prefixed symbol
  if (MARKET_SUBJECT_RE.test(q)) return true; // any market/platform vocabulary
  if (lookupGlossary(q) != null) return true; // a bare glossary/concept term
  return false;
}

/** True when a question carries NO market/platform subject at all — an off-topic ask that must get
 *  an honest scope envelope, never a market dump. Conservative: any subject at all → false. */
function isOffTopicQuestion(q: string): boolean {
  return !hasMarketSubject(q);
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

// English function words ("stopwords") that ALSO collide with — or could collide with, if added to
// KNOWN_TICKERS later — a real ticker symbol. The live gauntlet (PR-L4a) caught "right now" / "…now"
// resolving to $NOW (ServiceNow): the extractor uppercased the whole question, so the adverb "now"
// became the ticker "NOW" (which IS in KNOWN_TICKERS), and the staging fallback then answered with a
// ServiceNow desk verdict. A bare lowercase function word in a sentence must NEVER be read as a
// ticker — only an explicit `$` prefix or an unambiguous ticker context ("NOW stock", "ticker NOW")
// promotes it. This is deliberately the FUNCTION-WORD set only: content-noun tickers (ARM, CAT) are
// left alone because a capitalised "ARM"/"CAT" is far more often a genuine ticker reference, and
// over-restricting them would drop legitimate member mentions. Today only "NOW" intersects
// KNOWN_TICKERS, so the guard is surgical; the wider list future-proofs the allowlist.
const STOPWORD_TICKERS = new Set([
  "NOW", "ALL", "ARE", "OR", "BE", "GO", "SO", "AT", "ON", "IT", "IN", "OF", "TO",
  "THE", "AN", "AS", "IS", "IF", "BY", "WE", "US", "HE", "NO", "UP", "MY", "ME",
  "DO", "AND", "FOR", "BUT", "NOT", "YOU", "OUR", "OUT", "WHY", "HOW", "WHO", "ANY",
]);

/**
 * Unambiguous ticker context around a stopword-collision token: a "ticker/symbol/shares of" lead-in
 * or a "stock/shares/calls/puts/chart/equity" trailer. Case-SENSITIVE on the token (it must be the
 * UPPERCASE symbol, e.g. `NOW`), so "right now stock is cheap" (lowercase "now") can never trip the
 * trailer rule, while "NOW stock", "ticker NOW" and (via the `$` short-circuit) "$NOW" all promote.
 */
function hasTickerContext(question: string, symbol: string): boolean {
  const T = symbol.toUpperCase();
  const lead = new RegExp(`\\b(?:ticker|symbol|shares? of|share of)\\s+\\$?${T}\\b`).test(question);
  const trail = new RegExp(`\\b${T}\\s+(?:stock|shares|share|equity|calls?|puts?|chart|ticker)\\b`).test(question);
  return lead || trail;
}

/** True when a matched candidate is a real ticker reference (not a bare English stopword). Applies
 *  the stopword-collision guard: NOW/… only count with a `$` prefix or explicit ticker context. */
function acceptTicker(question: string, raw: string): string | null {
  const hadDollar = raw.startsWith("$");
  const cand = raw.replace(/^\$/, "").toUpperCase();
  if (!hadDollar && !KNOWN_TICKERS.has(cand)) return null;
  if (!hadDollar && STOPWORD_TICKERS.has(cand) && !hasTickerContext(question, cand)) return null;
  return cand;
}

/** Accepted tickers in question order (case preserved so "right now" ≠ "$NOW"). */
function acceptedTickers(question: string): string[] {
  // Match on the ORIGINAL string (case intact) — the whole-question toUpperCase() the old extractor
  // used is exactly what let the adverb "now" masquerade as the ticker "NOW".
  const matches = question.match(/\$?\b[A-Za-z]{1,5}\b/g) ?? [];
  const out: string[] = [];
  for (const m of matches) {
    const t = acceptTicker(question, m);
    if (t) out.push(t);
  }
  return out;
}

function extractKnownTicker(question: string): string | null {
  return acceptedTickers(question)[0] ?? null;
}

/** Up to two known tickers for compare routing. */
export function extractCompareTickers(question: string): [string, string] | null {
  const found: string[] = [];
  for (const t of acceptedTickers(question)) {
    if (!found.includes(t)) found.push(t);
    if (found.length >= 2) break;
  }
  return found.length >= 2 ? [found[0]!, found[1]!] : null;
}

export function classifyBieIntent(question: string, ledgerTickers: Set<string>): BieRoute | null {
  const q = question.trim();
  if (q.length > 160 || q.split(/[.?!]/).filter((s) => s.trim()).length > 2) return null;

  // "market regime?" / "what's the regime" → the LIVE regime read (market_context surfaces the HELIX
  // regime detector), never the glossary definition. Before the concept branch, which would otherwise
  // steal the bare phrase as a ≤4-word glossary lookup (#45).
  if (isLiveRegimeQuestion(q)) return { intent: "market_context", ticker: null };

  // Definitional/concept question → the glossary read. Placed FIRST (even before the explicit
  // "vector" branch) so "what is Vector" / "what is GEX" / "what does Night Hawk do" resolve to a
  // DEFINITION, while a live "vector setup on NVDA" (has a ticker) still routes to vector_read below.
  if (isConceptQuestion(q)) return { intent: "concept_read", ticker: null };

  // "pull/look up X from <internal path | provider>" → the governed universal reader. Only fires
  // when a path or provider is explicitly named, so a plain "show me the SPX setup" isn't stolen.
  if (isUniversalLookup(q)) return { intent: "universal_lookup", ticker: extractKnownTicker(q) };

  // "are the crons healthy / is UW up / is polygon down / is the data fresh / ops status" → the
  // governed OPS READ tools (task #58): read-only ops awareness (cron_runs / provider-health /
  // cache-probe / combined overview). MUST be before system_diagnostic — the diagnostic engine owns
  // the surface-forming "why isn't NVDA GEX forming" class, while a general "are the crons healthy"
  // / "is UW up" is an infra-health question answered from real cron-run/provider/cache state. Placed
  // before REASONING_RE for the same "why/is" bail-to-Claude reason as the diagnostic branch.
  if (isOpsReadQuestion(q)) return { intent: "ops_read", ticker: null };

  // "why isn't X forming / is the pipeline healthy / what's failing" → self-diagnosis from real ops
  // signals. MUST be before REASONING_RE (and before the vector branch, whose "forming" overlaps),
  // or "why" bails to Claude / the surface gets read as a normal Vector question.
  if (isDiagnosticQuestion(q)) return { intent: "system_diagnostic", ticker: extractKnownTicker(q) };

  // "tomorrow's plays" / "tonight's playbook" / "why was <ticker> picked/pulled" /
  // "what did the morning check see" / terse "nh <ticker>" → the Night Hawk EDITION
  // read (PR-N9), answered from the pinned publish/verdict/pull records. Before the
  // cortex branch (which owns commit/skip/exit — the 0DTE decision verbs) and before
  // REASONING_RE; the ticker-less "why was the top play picked" still falls to cortex.
  {
    const nh = nighthawkEditionRoute(q);
    if (nh) return nh;
  }

  // "cortex <ticker>" / "what does cortex say about X" / "why did we commit/skip/exit X"
  // → the Cortex decision read (pinned commit/skip records first, live composition
  // otherwise). Before the SPX-why/verdict branches on purpose: "why did we skip SPX"
  // is a DECISION question (not a desk read), and "cortex verdict on NVDA" must not be
  // stolen by the verdict trigger word. A ticker-less decision-why ("why was the top
  // play picked") still routes — the composer answers with the session's decisions.
  if (isCortexQuestion(q)) return { intent: "cortex_read", ticker: extractKnownTicker(q) };

  // "if SPX drops 1%" / "what happens if SPY breaks 745" / "if we lose the flip" / "SPX at 7450
  // scenario" → the deterministic SCENARIO what-if read (PR-L4c). Placed after concept/diagnostic/
  // nighthawk/cortex (a definitional/decision question keeps its home) and BEFORE the SPX/vector
  // structure branches and REASONING_RE (a bare "if" is not in REASONING_RE, but "what if" is — this
  // must win first so the hypothetical isn't bailed to Claude or answered as a static structure read).
  // Double-gated (trigger + parseable shift) so it only fires on a real hypothetical price move.
  {
    const scenario = scenarioRoute(q);
    if (scenario) return scenario;
  }

  // An explicitly UNSUPPORTED horizon (LEAP / multi-year / quarterly) can't be scoped by any desk.
  // Route to the Vector composer, which returns an HONEST "unsupported horizon" message rather than
  // letting the SPX desk / Vector "all" answer the whole-chain aggregate as if it were the LEAP.
  if (namesUnsupportedHorizon(q)) {
    return { intent: "vector_read", ticker: extractKnownTicker(q) ?? "SPX", horizon: "all" };
  }

  // Cross-surface cross-check (PR-L4e-4) — "cross-check Vector and the SPX desk: do they agree?".
  // BEFORE the VECTOR_RE branch (which would steal the "vector" mention) so the two-surface reconcile
  // reaches composeCrossCheck, which flags a material max-pain/flip/regime divergence instead of
  // silently answering one surface. Ticker defaults to SPX (the shared cross-surface index).
  if (isCrossCheckQuestion(q)) {
    return { intent: "cross_check", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
  }

  // Explicit "vector" mention → the deterministic Vector desk read, for ANY ticker (incl. SPX on
  // Vector). Placed first so the Vector product wins over the SPX-Sniper branches when named.
  if (VECTOR_RE.test(q)) {
    return { intent: "vector_read", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
  }

  // Verdict RECALL (task #83) — before SPX_WHY (which would steal a "why did you say SPX …" recall)
  // and before the fresh-verdict branch: a recall of a PAST verdict is answered from the pinned
  // case-law record, not re-graded from scratch.
  if (isVerdictRecallQuestion(q)) return { intent: "verdict", ticker: extractKnownTicker(q) };

  if (SPX_WHY_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (SPX_EXPLAIN_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (SPX_INVALIDATION_RE.test(q)) return { intent: "spx_invalidation", ticker: "SPX" };

  // Cross-tool verdict synthesis — placed before COMPARE/ADVICE so an explicit "grade this /
  // is X good / hold X into earnings" gets the deep multi-engine envelope, while "should I …"
  // (excluded in isVerdictQuestion) still falls through to the lighter ticker_advice path.
  if (isVerdictQuestion(q)) return { intent: "verdict", ticker: extractKnownTicker(q) };

  // Explicit compare keyword, OR a comparative question naming TWO known tickers ("Is SPX or NVDA
  // closer to its gamma flip?", "which of SPY or QQQ is stronger?") — the live-battery miss (PR-L1):
  // without a compare/versus/vs keyword the SPX structure branch stole the two-ticker question and
  // answered for SPX alone, never naming the second name. The two-DISTINCT-known-tickers gate
  // (extractCompareTickers) is what authorizes the route — a bare cue word ("which", "closer") with
  // zero or one ticker never routes here, so single-ticker questions keep their existing homes
  // (same single-word steal-risk discipline as the #334 alias rules).
  if (COMPARE_RE.test(q) || COMPARATIVE_CUE_RE.test(q)) {
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

  // "SPX vs its gamma flip" — one ticker vs its OWN structure level (#48). Route to that ticker's
  // structure read BEFORE REASONING_RE bails on the "vs". Non-SPX with a two-word "gamma flip" is
  // already caught above; this rescues the SPX case (and any single-ticker self-vs-level shape the
  // compound decomposer emits) from the null → "unavailable" drop.
  if (SELF_VS_LEVEL_RE.test(q)) {
    const t = extractKnownTicker(q);
    if (t && extractCompareTickers(q) == null) {
      return t === "SPX"
        ? { intent: "spx_structure", ticker: "SPX" }
        : { intent: "vector_read", ticker: t, horizon: extractHorizon(q) };
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
  // Same live-regime guard as the primary classifier — "market regime?" is the LIVE read, never the
  // glossary definition (#45). Before concept so the bare phrase isn't stolen as a glossary lookup.
  if (isLiveRegimeQuestion(q)) return { intent: "market_context", ticker: null };
  if (isConceptQuestion(q)) return { intent: "concept_read", ticker: null };
  if (isUniversalLookup(q)) return { intent: "universal_lookup", ticker: extractKnownTicker(q) };
  // Same placement as the primary classifier: governed ops read BEFORE system_diagnostic.
  if (isOpsReadQuestion(q)) return { intent: "ops_read", ticker: null };
  if (isDiagnosticQuestion(q)) return { intent: "system_diagnostic", ticker: extractKnownTicker(q) };
  // Same Night Hawk edition branch as the primary classifier (same placement: after
  // concept/diagnostic, before the cortex branch — "why was X picked/pulled" is an
  // overnight decision question).
  {
    const nh = nighthawkEditionRoute(q);
    if (nh) return nh;
  }
  // Same Cortex decision-read branch as the primary classifier (and same placement:
  // before the verdict/SPX branches so "cortex verdict on X" isn't stolen).
  if (isCortexQuestion(q)) return { intent: "cortex_read", ticker: extractKnownTicker(q) };
  // Same SCENARIO branch as the primary classifier (same placement: after cortex, before the vector/
  // SPX structure reads) — a hypothetical price-move question is a scenario, not a static desk dump.
  {
    const scenario = scenarioRoute(q);
    if (scenario) return scenario;
  }
  // Same cross-surface cross-check branch as the primary classifier (before VECTOR_RE, which would
  // steal the "vector" mention) — a two-surface reconcile must flag divergence, not dump one surface.
  if (isCrossCheckQuestion(q)) {
    return { intent: "cross_check", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
  }
  if (VECTOR_RE.test(q)) {
    return { intent: "vector_read", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
  }
  if (ZERODTE_RE.test(q)) return { intent: "zerodte_plays", ticker: null };
  if (SPX_INVALIDATION_RE.test(q)) return { intent: "spx_invalidation", ticker: "SPX" };
  // Verdict RECALL (task #83) — same placement rationale as the primary classifier.
  if (isVerdictRecallQuestion(q)) return { intent: "verdict", ticker: extractKnownTicker(q) };
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
  // OFF-TOPIC scope guard (PR-L4d-1) — placed AFTER every specific-intent router (so an edition
  // pick-why "why was CSX picked", a cortex decision-why, etc. keep their homes even when they carry
  // no generic market vocabulary) and BEFORE the generic market_context / ticker catch-alls. Every
  // remaining branch below requires a market subject (a known ticker or market/SPX vocabulary), so a
  // question with NO subject at all would otherwise fall through to the market_context DUMP — the
  // exact L4d-1 bug (a poem got a full SPX-desk + HELIX-tape dump). It gets an honest scope envelope.
  if (isOffTopicQuestion(q)) return { intent: "off_topic", ticker: null };
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
    case "ops_read":
      return ["Is UW up?", "Is the data fresh?", "What's the SPX setup right now?"];
    case "cortex_read":
      return ["Show today's 0DTE plays", "What is a Cortex veto?", "What does Cortex say about SPY?"];
    case "nighthawk_edition":
      return ["Show tonight's playbook", "What is publish context?", "What is the morning confirmation?"];
    case "scenario":
      return [
        "What if it moves the other way?",
        "What's the setup right now?",
        "Which walls are building vs fading?",
      ];
    case "cross_check":
      return [
        "What's the full SPX desk read?",
        "Show the Vector desk read for SPX",
        "Which walls are building vs fading?",
      ];
    case "off_topic":
      return [
        "What's the SPX setup right now?",
        "How are today's plays doing?",
        "What is the gamma flip?",
      ];
  }
}
