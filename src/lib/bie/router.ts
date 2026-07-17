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
import { parseShift } from "./scenario-read";
import {
  isNonsenseQuestion,
  wantsBrevity,
  wantsCallWallOnly,
  wantsCharmLens,
  wantsContradictionExplain,
  wantsEngineState,
  wantsGammaFlipOnly,
  wantsGexVexCompare,
  wantsHelixPrintList,
  wantsHonestUnknown,
  wantsKingNodeOnly,
  wantsLottoState,
  wantsMatrixDelta,
  wantsPowerHour,
  wantsPutWallOnly,
  wantsPlaySuggest,
  wantsTechnicals,
  wantsThermalDeskCompare,
  wantsVixOnly,
  wantsWallDynamics,
  shouldAvoidSpxDeskDump,
} from "./question-focus";

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
  | "record_read"
  | "cortex_read"
  | "nighthawk_edition"
  | "scenario"
  | "platform_read"
  | "thermal_read"
  | "helix_read"
  | "grid_rejections_read"
  | "play_engine_read"
  | "clarify_read"
  | "technical_read"
  | "play_suggest_read"
  | "wall_dynamics_read";

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
  /\b(spx|es|s&p)\b[^?]*\b(levels?|structure|walls?|gamma( flip)?|flip|max pain|king node|support|resistance)\b|\b(levels?|structure|walls?|gamma flip|max pain|king node)\b[^?]*\b(spx|es|s&p)\b/i;

const SPX_DESK_READ_RE =
  /\b(spx|s&p|es)\b.*\b(read|setup|bias|trade|desk|update|doing|look(ing)?|now|slayer|channel|commentary|brief)\b|\bwhat'?s? (the )?(spx|s&p) (setup|read|trade|bias|desk|doing)\b|\blive desk\b.*\bspx\b|\bspx channel\b|\bcommentary on spx\b/i;

const SPX_INVALIDATION_RE =
  /\b(invalidate|invalidat|kill|what (would|kills)|thesis dead|go flat|what breaks|bull thesis die|bearish case)\b.*\b(spx|setup|read|play|slayer|case)\b|\b(spx|setup|play|slayer)\b.*\b(invalidate|kill|flip it|lose|breaks)\b|\bwhat would flip\b/i;

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
  /\b(unusual flow|whale print|flow tape|any flow|big flow|hedging flows?|massive flow|lit flow|net flow|block print|sweep|hot tickers?|flow brief|repeat buyer|unusual activity)\b/i;

const HELIX_READ_RE =
  /\b(helix|flow analytics|strike stack|anomaly near.?miss|dark pool (activity|prints?|flow)|helix rail|helix tape|top \d+.*prints?|prints? by premium|list only.*prints?|whale prints?|biggest flow|unusual options|call sweep|put sweep|block prints?|premium concentration|skew buying|net premium)\b|\bdark pool\b.*\b(activity|flow|prints?)\b/i;

const THERMAL_READ_RE =
  /\b(thermal|heatmap|heat map|blackout thermal|gex matrix|matrix data|dealer gamma|gamma matrix|gex positioning|vex lens|dex lens|charm lens|skew lens|gex on|vex on|dex on|charm on|matrix.{0,60}(changed|shift|last \d+ min)|(changed|shift).{0,40}matrix|gex vs vex|vex vs gex|thermal.{0,20}(agree|align).{0,20}desk|\bskew\b.{0,20}(spx|0dte|0 dte))\b/i;

const GRID_REJECTIONS_RE =
  /\b(grid rejection|grid scanner|0dte rejection|scanner rejection|rejections?.{0,20}(grid|scanner)|why didn'?t .{0,30}(make|hit) the (grid|board|scanner)|why did grid reject|grid reject|near.?miss.{0,20}(grid|0dte|scanner)|gate reject.{0,20}(grid|0dte|scanner)|fresh finds)\b/i;

const PLAY_SUGGEST_RE =
  /\b(what should i trade|best play|trade idea|play suggestion|suggest a (trade|play)|what would you trade|idea for a trade|0dte idea|give me a (trade|play)|recommended (strike|play)|what (play|strike) (do you|would you)|actionable (play|trade)|desk lean|ticket for)\b/i;

const TECHNICALS_RE =
  /\b(rsi|macd|atr|ema\s*(20|50|200)|technical(s)?|chart setup|chart read|swing high|swing low|support and resistance|moving average|trend line|overbought|oversold|relative strength)\b/i;

const WALL_DYNAMICS_RE =
  /\b(walls? (are )?(building|fading|forming|dissolv|stacking|holding|breaking)|building (vs|or) fading|wall dynamics|wall integrity|beads forming|which walls|dealer walls?|gamma walls?|gex walls?|wall strength|wall ladder|restack)\b/i;

const PLAY_ENGINE_RE =
  /\b(play engine|slayer engine|spx engine|engine state|engine long|engine short|long or short right now|power hour)\b/i;

const SECTOR_FLOW_RE = /\b(sector flow|semiconductor|semi flow|safe haven flow)\b/i;

const BREADTH_RE = /\b(mag7|mag 7|market breadth|breadth today)\b/i;

const PIN_RISK_RE = /\b(pin risk|pinning|pin at|pin into)\b/i;

const LOTTO_ENGINE_RE = /\blotto\b.*\b(engine|state|phase)\b|\blotto engine\b/i;

const CONTRADICTION_EXPLAIN_RE =
  /\b(why did you say|you said).{0,40}\b(bearish|bullish)\b.{0,40}\b(bearish|bullish)\b|\b(bearish|bullish)\b.{0,20}\b(and|but)\b.{0,20}\b(bearish|bullish)\b/i;

const ADVICE_RE =
  /\b(should i|would you|can i|worth (buying|selling)|buy|sell|hold|trim|into earnings|before earnings|after earnings)\b/i;

const COMPARE_RE = /\b(compare|versus|vs\.?)\b/i;
/** Comparative cues that make a TWO-ticker question a compare even without a compare/vs keyword —
 *  "is SPX or NVDA closer to its flip?", "which of SPY or QQQ is stronger?". Deliberately weak on
 *  its own: the compare branch additionally requires extractCompareTickers to find two DISTINCT
 *  known tickers, so these common words can never hijack a single-ticker or ticker-less question. */
const COMPARATIVE_CUE_RE =
  /\b(closer|closest|nearer|nearest|farther|further|which|more|less|higher|lower|stronger|weaker|better|worse)\b/i;

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
  /\b(verdict|the call|final call|bottom line|give me (a|the|your) (call|read|verdict|take|grade)|grade (this|the|it|my|\s+[A-Z]{1,5}\s+\d{3,5}))\b/i;
const VERDICT_GRADE_RE =
  /\bis\b[^?]{0,48}\b(a\s+)?(good|solid|smart|worth it|worth taking)\b(?:[^?]{0,24}\b(play|trade|idea|entry|setup|buy|call|long|short)\b)?|\bgrade\b[^?]{0,40}\b(calls?|puts?|0dte|spreads?)\b/i;
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
  /\b(doing|happening|going on|right now|look(ing)? like|the setup|the play|the trade|the bias|the read|tonight|tonight's|today's|tomorrow|tomorrow's|latest|current|this week|edition|playbook)\b/i;
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

function nighthawkSubjectTicker(q: string): string | null {
  const subj = q.match(NH_PICK_SUBJECT_RE)?.[1]?.toUpperCase() ?? null;
  if (subj && !NH_PICK_STOPWORDS.has(subj)) return subj;
  return extractKnownTicker(q);
}

function nighthawkEditionRoute(q: string): BieRoute | null {
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
const SCENARIO_TRIGGER_RE =
  /\b(if|what\s+if|suppose|imagine|assume|were\s+to|scenario|hypothetical(?:ly)?)\b/i;

function scenarioRoute(q: string): BieRoute | null {
  if (!SCENARIO_TRIGGER_RE.test(q)) return null;
  if (parseShift(q) == null) return null; // no scopeable price move → not a scenario
  return { intent: "scenario", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
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

// Track-record / performance questions — "honest record", "track record", "how have the plays performed",
// "win rate", "P&L on yesterday's plays". Routed to the recordRead composer, which fans out to the
// published track-record endpoint (/api/track-record/publish). Placed before REASONING_RE so these
// deterministic reads don't fall through to Claude.
const RECORD_RE =
  /\b(honest record|track[- ]?record|performance|track (record |)?on (today'?s|the) plays?|win\s*rate|how (well|good|have).{0,40}(perform(?:ed|s|ance)?|done|doing)|historical (plays|records?|performance|p&l|hit rate)|past .{0,30}(record|performance)|p&l.{0,30}(yesterday|today|week)|engine historical hit rate)\b/i;

const PREMIUM_SELL_RE = /\b(good day|bad day|right day).{0,20}(sell|short) premium\b|\bsell premium\b/i;

const OPTIONS_STRATEGY_RE = /\b(calendar spread|iron condor|credit spread|debit spread|covered call|straddle|strangle)\b/i;

// Cross-product / "know everything" asks — full bie:full-state snapshot (Thermal matrix, Vector, HELIX, etc.).
const PLATFORM_READ_RE =
  /\b(whole platform|full platform|all products|every product|every tool|platform snapshot|everything on (the )?(site|platform|desk)|all (the )?(data|numbers)|complete platform|blackout platform|in and out about|know(s)? (in and out|everything)|full system|entire platform|snapshot of all live tools|which tools are live|tools are live right now|BIE data freshness)\b/i;

// Out-of-scope queries that should never route through BIE — "write me a poem", "tell me a joke",
// "explain quantum physics", etc. These return null to trigger the "out of scope" response rather
// than falling through to Claude or returning a generic answer. Added guard BEFORE REASONING_RE so
// it catches them before "explain" is tested.
const OUT_OF_SCOPE_RE =
  /\b(write me|tell me|make me|create|compose|generate|write a|tell a|make a)\s+(poem|joke|story|song|recipe|code|app|game|essay|article|movie|script)\b|\bexplain\b.{0,40}(quantum|physics|math|relativity|thermodynamics|calculus)\b|\bhow does\b.{0,40}(quantum|physics|relativity)\b/i;

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

function narrowStructureRoute(q: string): BieRoute | null {
  if (isConceptQuestion(q)) return null;
  if (SCENARIO_TRIGGER_RE.test(q)) return null;
  if ((COMPARE_RE.test(q) || COMPARATIVE_CUE_RE.test(q)) && extractCompareTickers(q)) return null;
  const horizon = extractHorizon(q);
  if (isSpxHorizonScopedStructureQuestion(q, horizon)) return null;

  if (wantsKingNodeOnly(q)) {
    const t = extractKnownTicker(q) ?? "SPX";
    if (t !== "SPX") {
      return { intent: "vector_read", ticker: t, horizon: extractHorizon(q) };
    }
  }

  const ticker = extractKnownTicker(q);
  if (ticker && ticker !== "SPX") return null;
  if (
    wantsPutWallOnly(q) ||
    wantsCallWallOnly(q) ||
    (wantsKingNodeOnly(q) && (extractKnownTicker(q) ?? "SPX") === "SPX") ||
    wantsGammaFlipOnly(q)
  ) {
    return { intent: "spx_structure", ticker: "SPX" };
  }
  return null;
}

function narrowThermalRoute(q: string): BieRoute | null {
  if (wantsCharmLens(q) || wantsGexVexCompare(q) || wantsThermalDeskCompare(q)) {
    return { intent: "thermal_read", ticker: extractKnownTicker(q) ?? "SPX" };
  }
  return null;
}

export function classifyBieIntent(question: string, ledgerTickers: Set<string>): BieRoute | null {
  const q = question.trim();
  if (isNonsenseQuestion(q)) return { intent: "clarify_read", ticker: null };
  if (wantsHonestUnknown(q)) return { intent: "clarify_read", ticker: null };
  if (q.length > 160 || q.split(/[.?!]/).filter((s) => s.trim()).length > 2) return null;

  const narrowStructure = narrowStructureRoute(q);
  if (narrowStructure) return narrowStructure;
  if (wantsHelixPrintList(q)) {
    return { intent: "helix_read", ticker: extractKnownTicker(q) };
  }
  if (HELIX_READ_RE.test(q)) {
    return { intent: "helix_read", ticker: extractKnownTicker(q) };
  }
  if (FLOW_TAPE_RE.test(q)) {
    return { intent: "flow_tape", ticker: extractKnownTicker(q) };
  }
  if (GRID_REJECTIONS_RE.test(q)) {
    return { intent: "grid_rejections_read", ticker: extractKnownTicker(q) };
  }
  const narrowThermal = narrowThermalRoute(q);
  if (narrowThermal) return narrowThermal;
  if (wantsWallDynamics(q) || WALL_DYNAMICS_RE.test(q)) {
    return { intent: "wall_dynamics_read", ticker: extractKnownTicker(q) ?? "SPX" };
  }
  if (wantsPlaySuggest(q) || PLAY_SUGGEST_RE.test(q)) {
    return { intent: "play_suggest_read", ticker: extractKnownTicker(q) ?? "SPX" };
  }
  if ((COMPARE_RE.test(q) || COMPARATIVE_CUE_RE.test(q)) && extractCompareTickers(q)) {
    const pair = extractCompareTickers(q);
    if (pair) return { intent: "ticker_compare", ticker: pair[0], ticker_b: pair[1] };
  }
  if (wantsTechnicals(q) || (TECHNICALS_RE.test(q) && extractKnownTicker(q))) {
    return { intent: "technical_read", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
  }
  if (wantsVixOnly(q)) return { intent: "market_context", ticker: null };
  if (wantsBrevity(q) && /\b(spx|s&p|es|slayer|bias|direction|setup)\b/i.test(q)) {
    return { intent: "spx_desk_read", ticker: "SPX" };
  }

  if (CONTRADICTION_EXPLAIN_RE.test(q) || wantsContradictionExplain(q)) {
    return { intent: "spx_desk_read", ticker: "SPX" };
  }
  if (PLAY_ENGINE_RE.test(q) || wantsEngineState(q) || wantsPowerHour(q)) {
    return { intent: "play_engine_read", ticker: "SPX" };
  }
  if (LOTTO_ENGINE_RE.test(q) || wantsLottoState(q)) {
    return { intent: "play_engine_read", ticker: "SPX" };
  }
  if (wantsMatrixDelta(q)) {
    return { intent: "thermal_read", ticker: extractKnownTicker(q) ?? "SPX" };
  }
  if (BREADTH_RE.test(q) && !extractKnownTicker(q)) {
    return { intent: "market_context", ticker: null };
  }
  if (SECTOR_FLOW_RE.test(q) || PIN_RISK_RE.test(q)) {
    const ticker = extractKnownTicker(q);
    if (PIN_RISK_RE.test(q) && /\b(spx|s&p|7500|7600|7[0-9]{3})\b/i.test(q)) {
      return { intent: "spx_structure", ticker: "SPX" };
    }
    if (SECTOR_FLOW_RE.test(q)) return { intent: "helix_read", ticker: ticker };
  }

  // Definitional/concept question → the glossary read. Placed FIRST (even before the explicit
  // "vector" branch) so "what is Vector" / "what is GEX" / "what does Night Hawk do" resolve to a
  // DEFINITION, while a live "vector setup on NVDA" (has a ticker) still routes to vector_read below.
  // Track-record / platform-wide reads beat glossary "what is X" concept routing.
  if (RECORD_RE.test(q)) {
    return { intent: "record_read", ticker: extractKnownTicker(q) };
  }
  if (PLATFORM_READ_RE.test(q)) {
    return { intent: "platform_read", ticker: null };
  }

  if (GRID_REJECTIONS_RE.test(q)) {
    return { intent: "grid_rejections_read", ticker: extractKnownTicker(q) };
  }

  if (isConceptQuestion(q)) return { intent: "concept_read", ticker: null };
  if (OPTIONS_STRATEGY_RE.test(q) && !CONCEPT_LIVE_HINT_RE.test(q)) {
    return { intent: "concept_read", ticker: null };
  }

  // "pull/look up X from <internal path | provider>" → the governed universal reader. Only fires
  // when a path or provider is explicitly named, so a plain "show me the SPX setup" isn't stolen.
  if (isUniversalLookup(q)) return { intent: "universal_lookup", ticker: extractKnownTicker(q) };

  // "why isn't X forming / is the pipeline healthy / what's failing" → self-diagnosis from real ops
  // signals. MUST be before REASONING_RE (and before the vector branch, whose "forming" overlaps),
  // or "why" bails to Claude / the surface gets read as a normal Vector question.
  if (isDiagnosticQuestion(q)) return { intent: "system_diagnostic", ticker: extractKnownTicker(q) };

  // Out-of-scope queries that don't belong in a market-focused engine — "write me a poem",
  // "explain quantum physics", etc. Return null to trigger the "out of scope" response rather
  // than falling through to Claude or a generic answer.
  if (OUT_OF_SCOPE_RE.test(q)) return null;

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
  if (/\bdealer hedging\b/i.test(q) && /\bif i buy\b/i.test(q)) {
    return { intent: "concept_read", ticker: null };
  }

  // An explicitly UNSUPPORTED horizon (LEAP / multi-year / quarterly) can't be scoped by any desk.
  // Route to the Vector composer, which returns an HONEST "unsupported horizon" message rather than
  // letting the SPX desk / Vector "all" answer the whole-chain aggregate as if it were the LEAP.
  if (namesUnsupportedHorizon(q)) {
    return { intent: "vector_read", ticker: extractKnownTicker(q) ?? "SPX", horizon: "all" };
  }

  // Explicit "vector" mention → the deterministic Vector desk read, for ANY ticker (incl. SPX on
  // Vector). Placed first so the Vector product wins over the SPX-Sniper branches when named.
  if (VECTOR_RE.test(q)) {
    return { intent: "vector_read", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
  }

  if (SPX_WHY_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (SPX_EXPLAIN_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (SPX_INVALIDATION_RE.test(q)) return { intent: "spx_invalidation", ticker: "SPX" };

  // Premium-selling posture — before verdict (avoids stealing "good day to sell premium").
  if (PREMIUM_SELL_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };

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

  if (HELIX_READ_RE.test(q)) {
    return { intent: "helix_read", ticker: extractKnownTicker(q) };
  }

  if (THERMAL_READ_RE.test(q) || (/\bcharm\b/i.test(q) && /\b(spx|0dte|0 dte)\b/i.test(q))) {
    return { intent: "thermal_read", ticker: extractKnownTicker(q) ?? "SPX" };
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

  // Track-record / performance questions → handled at top (before concept_read).
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
  if (/\bvix\b/i.test(q)) return { intent: "market_context", ticker: null };
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
  if (shouldAvoidSpxDeskDump(q)) return false;
  if (q.length > 200 || q.split(/[.?!]/).filter((s) => s.trim()).length > 2) return false;
  if (REASONING_RE.test(q) && !/\b(spx|s&p|gamma|gex|dealer)\b/i.test(q)) return false;
  if (HELIX_READ_RE.test(q) || THERMAL_READ_RE.test(q) || GRID_REJECTIONS_RE.test(q)) return false;
  if (PLAY_ENGINE_RE.test(q) || LOTTO_ENGINE_RE.test(q)) return false;
  if (WALL_DYNAMICS_RE.test(q) || PLAY_SUGGEST_RE.test(q) || TECHNICALS_RE.test(q)) return false;
  return /\b(spx|s&p|es|slayer|sniper|0dte|gamma|gex|dealer)\b/i.test(q);
}

export function classifyBieStagingFallback(question: string): BieRoute {
  const q = question.trim();
  if (isNonsenseQuestion(q)) return { intent: "clarify_read", ticker: null };
  if (wantsHonestUnknown(q)) return { intent: "clarify_read", ticker: null };
  const narrowStructure = narrowStructureRoute(q);
  if (narrowStructure) return narrowStructure;
  if (wantsHelixPrintList(q)) {
    return { intent: "helix_read", ticker: extractKnownTicker(q) };
  }
  if (HELIX_READ_RE.test(q)) {
    return { intent: "helix_read", ticker: extractKnownTicker(q) };
  }
  if (FLOW_TAPE_RE.test(q)) {
    return { intent: "flow_tape", ticker: extractKnownTicker(q) };
  }
  if (GRID_REJECTIONS_RE.test(q)) {
    return { intent: "grid_rejections_read", ticker: extractKnownTicker(q) };
  }
  const narrowThermal = narrowThermalRoute(q);
  if (narrowThermal) return narrowThermal;
  if (wantsWallDynamics(q) || WALL_DYNAMICS_RE.test(q)) {
    return { intent: "wall_dynamics_read", ticker: extractKnownTicker(q) ?? "SPX" };
  }
  if (wantsPlaySuggest(q) || PLAY_SUGGEST_RE.test(q)) {
    return { intent: "play_suggest_read", ticker: extractKnownTicker(q) ?? "SPX" };
  }
  if ((COMPARE_RE.test(q) || COMPARATIVE_CUE_RE.test(q)) && extractCompareTickers(q)) {
    const pair = extractCompareTickers(q);
    if (pair) return { intent: "ticker_compare", ticker: pair[0], ticker_b: pair[1] };
  }
  if (wantsTechnicals(q) || (TECHNICALS_RE.test(q) && extractKnownTicker(q))) {
    return { intent: "technical_read", ticker: extractKnownTicker(q) ?? "SPX", horizon: extractHorizon(q) };
  }
  if (wantsVixOnly(q)) return { intent: "market_context", ticker: null };
  if (wantsBrevity(q) && /\b(spx|s&p|es|slayer|bias|direction|setup)\b/i.test(q)) {
    return { intent: "spx_desk_read", ticker: "SPX" };
  }
  if (CONTRADICTION_EXPLAIN_RE.test(q) || wantsContradictionExplain(q)) {
    return { intent: "spx_desk_read", ticker: "SPX" };
  }
  if (PLAY_ENGINE_RE.test(q) || wantsEngineState(q) || wantsPowerHour(q) || LOTTO_ENGINE_RE.test(q) || wantsLottoState(q)) {
    return { intent: "play_engine_read", ticker: "SPX" };
  }
  if (wantsMatrixDelta(q)) return { intent: "thermal_read", ticker: extractKnownTicker(q) ?? "SPX" };
  if (BREADTH_RE.test(q) && !extractKnownTicker(q)) return { intent: "market_context", ticker: null };
  if (SECTOR_FLOW_RE.test(q)) return { intent: "helix_read", ticker: extractKnownTicker(q) };
  if (PIN_RISK_RE.test(q) && /\b(spx|s&p|7[0-9]{3})\b/i.test(q)) return { intent: "spx_structure", ticker: "SPX" };
  // Track-record / platform-wide reads beat glossary "what is X" concept routing.
  if (RECORD_RE.test(q)) {
    return { intent: "record_read", ticker: extractKnownTicker(q) };
  }
  if (PLATFORM_READ_RE.test(q)) {
    return { intent: "platform_read", ticker: null };
  }

  if (GRID_REJECTIONS_RE.test(q)) {
    return { intent: "grid_rejections_read", ticker: extractKnownTicker(q) };
  }

  if (isConceptQuestion(q)) return { intent: "concept_read", ticker: null };
  if (isUniversalLookup(q)) return { intent: "universal_lookup", ticker: extractKnownTicker(q) };
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
  if (HELIX_READ_RE.test(q)) return { intent: "helix_read", ticker: extractKnownTicker(q) };
  if (PREMIUM_SELL_RE.test(q)) return { intent: "spx_desk_read", ticker: "SPX" };
  if (THERMAL_READ_RE.test(q) || (/\bcharm\b/i.test(q) && /\b(spx|0dte)\b/i.test(q))) {
    return { intent: "thermal_read", ticker: extractKnownTicker(q) ?? "SPX" };
  }
  if (GRID_REJECTIONS_RE.test(q)) return { intent: "grid_rejections_read", ticker: extractKnownTicker(q) };
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
  if (/\b(mag7|mag 7|breadth)\b/i.test(q) && !extractKnownTicker(q)) {
    return { intent: "market_context", ticker: null };
  }
  if (/\b(spx|s&p|gamma|gex|vwap|slayer|0dte|dealer|flip|tick index|pre.?market|lunch chop|opening range)\b/i.test(q)) {
    return { intent: "spx_desk_read", ticker: "SPX" };
  }
  {
    const t = extractKnownTicker(q);
    if (t && /\b(weak|strong|unusual|flow|safe haven|blow.?off)\b/i.test(q)) {
      return { intent: /\bflow\b/i.test(q) ? "helix_read" : "ticker_ecosystem", ticker: t };
    }
  }
  if (/\bvix\b/i.test(q)) {
    return { intent: "market_context", ticker: null };
  }
  if (/\b(market|spy|qqq|breadth|regime|tape|anomal)/i.test(q)) {
    return { intent: "market_context", ticker: null };
  }
  if (ticker) return { intent: "ticker_advice", ticker };
  return { intent: "clarify_read", ticker: null };
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
    case "record_read":
      return ["What is the SPX setup right now?", "Show unusual flow", "SPX vs Night Hawk record?"];
    case "platform_read":
      return ["What's the SPX desk read?", "Show the Thermal matrix flip", "Any 0DTE plays live?"];
    case "thermal_read":
      return ["Show VEX flip too", "What's the SPX desk setup?", "Compare Thermal SPY vs QQQ"];
    case "helix_read":
      return ["Any whale prints?", "What's going on with the top ticker?", "What's the SPX setup?"];
    case "grid_rejections_read":
      return ["Show today's 0DTE plays", "Cortex verdict on NVDA", "Why was the top play picked?"];
    case "play_engine_read":
      return ["What's the SPX setup right now?", "What would flip this read?", "How are today's plays doing?"];
    case "clarify_read":
      return ["What's the SPX setup right now?", "Any unusual flow right now?", "Compare NVDA vs AMD"];
    case "wall_dynamics_read":
      return ["What's the full SPX desk read?", "Which strike is king node?", "Compare GEX vs VEX"];
    case "technical_read":
      return ["What's the Vector setup?", "What's the SPX desk read?", "Show relative strength vs SPY"];
    case "play_suggest_read":
      return ["What would invalidate this?", "Show the flow tape", "What's the full desk read?"];
    default:
      return [];
  }
}
