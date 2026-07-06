/** Shared intent keyword patterns for Largo tool routing and question analysis. */

export const SPX_DESK_RE =
  /\b(spx|s&p 500|s&p|0dte|sniper|gamma flip|gex|dealer|max pain|vwap|hod|lod|pdh|pdl|internals|tick|trin|greek flow|dealer gamma|mag7|mag 7|mega.?cap)\b/;

export const SPX_DESK_TOOLS_RE = /\b(spx|s&p|play|signal|0dte|sniper|gamma|gex|dealer|greek flow|mag7|mag 7)\b/;

// Task #130: "flow" originally had no plural/gerund sibling the way "sweep"/"sweeps"
// already did in this same alternation — "\bflow\b" does not match "flows" or
// "flowing" (a word-boundary requires a non-word char immediately after "flow", which
// "flows"/"flowing" don't have). Verified via a standalone repro: "any options flows
// building up today" and "any big outflows today" both left needsFlow false and
// dropped get_options_flow/get_global_flow/get_postgres_flows out of Largo's tool
// ALLOWLIST entirely (getToolsForIntent), not just out of the soft guidance-hint text
// — and also skipped the get_flow_tape/get_greek_flow live-feed pre-fetch gated on
// needsFlow (largo-live-feed.ts). Added "flows"/"flowing" as explicit siblings, same
// style as the pre-existing "sweep"/"sweeps" pair, for both natural inflections.
export const FLOW_RE =
  /\b(flow|flows|flowing|sweep|whale|dark pool|tape|premium|unusual|sweeps|nope|tide)\b/;

export const FLOW_TOOLS_RE = /\b(flow|flows|flowing|tape|sweep|whale|dark pool|premium|unusual)\b/;

export const PLAY_STATE_RE =
  /\b(spx|s&p|0dte|sniper|lotto)\b.*\b(buy|sell|hold|trim|play|setup|signal)\b|\b(play state|open play|desk play)\b/i;

export const NEWS_RE = /\b(news|headline|catalyst|earnings|cpi|fomc|macro|calendar|gdp|unemployment|inflation)\b/;

export const NEWS_TOOLS_RE = /\b(earnings|news|catalyst|cpi|fomc|macro|calendar|gdp|unemployment|inflation)\b/;

export const VOL_RE = /\b(iv|vol|vix|skew|rank|realized)\b/;

export const VOL_TOOLS_RE = /\b(vol|vix|iv|skew|rank)\b/;

// "edition"/"editions" added alongside the existing bare tokens (task #143) — the
// live /nighthawk UI itself renders "Edition live" / "Prior edition" as its own
// primary vocabulary (PlaybookBoard.tsx), so a member asking "what's in tonight's
// edition" or "is a new edition live yet" uses completely natural product language
// that had NO token in this regex at all. Verified via a standalone
// getToolsForIntent() repro before the fix: that phrasing matched none of
// nighthawk/night hawk/playbook/tomorrow/evening plays/hawk plays/top plays/hawk,
// so NIGHTHAWK_RE never fired, TOOL_GROUPS.platform (get_nighthawk_edition,
// get_platform_snapshot, get_nighthawk_outcomes, get_nighthawk_dossier, etc.) was
// never added to the turn's tool allowlist, and getToolsForIntent's own
// `names.size <= 2` fallback dumped the ENTIRE unrelated CORE_TOOLS bundle (SPX
// desk + stock analysis + vol analysis) instead — the same class of "plainly
// on-topic phrasing silently drops the right tool bundle" bug task #130 found and
// fixed for FLOW_RE's missing "flows"/"flowing" siblings. Added as a flat bare
// alternative (matching this regex's own pre-existing style, not a new
// co-occurrence idiom) for the same "minimal, precedent-matching" reason task
// #130 gave for its own fix.
export const NIGHTHAWK_RE =
  /\b(nighthawk|night hawk|playbook|tomorrow|evening plays|hawk plays|top plays|hawk|edition|editions)\b/;

/**
 * A Night Hawk question scoped to a SPECIFIC day (task #143) — "yesterday's
 * edition," "last night's picks," "what did Night Hawk say on Monday," an
 * explicit date. This is a REAL capability split, not just a wording nuance:
 * get_nighthawk_edition's `date` (YYYY-MM-DD) param can serve any past edition,
 * while get_platform_snapshot's `nighthawk`/`nighthawk_edition` fields are
 * ALWAYS the latest published edition, full_edition:true or not — there is no
 * parameter on get_platform_snapshot that can ever answer a dated question, so a
 * turn that resolves to get_platform_snapshot here would silently answer the
 * wrong night's picks rather than merely a thinner summary. REQUIRES
 * co-occurrence with a nighthawk-ish token (same false-positive discipline as
 * ZERODTE_REJECTION_RE/FLOW_ANOMALY_NEAR_MISS_RE) — a bare "yesterday" or
 * "last Monday" alone is common phrasing for entirely unrelated questions (a
 * stock's prior close, an earnings date) and must not fire on its own.
 */
export const NIGHTHAWK_DATED_EDITION_RE =
  /(?=.*\b(?:nighthawk|night hawk|hawk|playbook|edition|editions)\b)(?=.*\b(?:yesterday|last night|prior night|previous night|night before|last week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b)/i;

/**
 * SPX Slayer's OWN play-engine state (get_spx_play) — phase/setup/bias/confluence/gate
 * wording next to an SPX-like token, or "play ... veto/reject(ed/ion)" (the play-engine
 * is the only thing on the desk with gate-block reasoning to explain, so a bare
 * "why did the play get rejected" is unambiguous even without an explicit spx/sniper
 * token). Kept distinct from MARKET_REGIME_RE below so an engine-state question
 * doesn't also nudge Largo toward the market-wide get_market_regime tool (LARGO-110).
 */
export const SPX_ENGINE_STATE_RE =
  /\b(spx|s&p|0dte|sniper|slayer)\b.*\b(phase|setup|bias|confluence|gate|gates|veto|vetoed|reject|rejected|rejection)\b|\b(phase|setup|bias|confluence|gate|gates|veto|vetoed|reject|rejected|rejection)\b.*\b(spx|s&p|0dte|sniper|slayer)\b|\bplay\b.*\b(veto|vetoed|reject|rejected|rejection)\b|\b(veto|vetoed|reject|rejected|rejection)\b.*\bplay\b/;

/**
 * Market-wide backdrop wording (get_market_regime) — regime/backdrop/environment/playbook,
 * as opposed to SPX Slayer's own play-engine phase/gates (SPX_ENGINE_STATE_RE above).
 */
export const MARKET_REGIME_RE = /\b(market regime|regime|backdrop|environment|playbook)\b/;

/**
 * 0DTE Command's OWN multi-ticker scanner (the "0DTE Command" tab at /grid,
 * `src/lib/zerodte/scan.ts` / `board.ts`) — wording that names the scanner/board
 * itself, or scan/hunt/find wording paired with 0dte, as distinct from SPX
 * Slayer's own single-instrument 0DTE engine. This is DELIBERATELY more specific
 * than the bare "0dte" token already in SPX_DESK_RE / SPX_DESK_TOOLS_RE /
 * PLAY_STATE_RE / SPX_ENGINE_STATE_RE (left alone — "0dte" alone is still a
 * legitimate SPX Slayer signal, since SPX Slayer is also a 0DTE product) and
 * than getToolsForIntent's own bare zero-dte match (which already adds
 * get_zerodte_plays to the tool ALLOWLIST on that same bare token). Both engines
 * are branded with the word "0DTE" (SPX Slayer's dashboard vs. the separate
 * multi-ticker "0DTE Command"/BlackOut Grid scanner), so a bare "0dte" mention
 * alone hints BOTH engines with no disambiguating signal — this regex exists so
 * a question that names the scanner specifically ("grid scanner," "0dte
 * command," or "hunt(er)"/"scan(ner)"/"find(s)" paired with 0dte/zero-dte) gets
 * an EXTRA, stronger hint toward get_zerodte_plays instead of relying on the
 * same ambiguous bare token both engines already share (task #127). The
 * hunt/scan/find family REQUIRES 0dte/zero-dte co-occurrence in the same
 * question — a bare "hunt"/"scanner" (e.g. "what is Night Hawk hunting
 * tonight," "did the market scanner pick up anything") is common wording for
 * entirely unrelated products and must not fire this on its own.
 */
export const ZERODTE_COMMAND_RE =
  /\b(0dte command|zero.?dte command|command board|grid scanner|grid board|blackout grid|across tickers|multi.?ticker|fresh finds?)\b|\b(scan|scans|scanning|scanner|hunt|hunts|hunting|hunter|find|finds|finding)\b.*\b(0.?dte|zero.?dte)\b|\b(0.?dte|zero.?dte)\b.*\b(scan|scans|scanning|scanner|hunt|hunts|hunting|hunter|find|finds|finding)\b/i;

/**
 * 0DTE Command near-miss/rejection wording ("why didn't X make the grid board,"
 * "near miss," "what gate did X fail on 0dte," "wasn't flagged by the scanner") —
 * hints get_zerodte_rejections (task #147), the durable per-ticker gate-rejection
 * log. Deliberately REQUIRES co-occurrence with an explicit 0dte/grid token (not a
 * bare "board"/"scanner"/"scan," which are generic words used across many
 * unrelated surfaces), same false-positive discipline ZERODTE_COMMAND_RE's own
 * hunt/scan/find family uses after its task #127 merge-time fix — "near miss" or
 * "didn't make the cut" alone is common phrasing for completely unrelated
 * questions (a Night Hawk exclusion, a screener miss, a stop-loss near-touch) and
 * must not fire on its own. A bare "why didn't X make the board" with no 0dte/grid
 * token stays unresolved on purpose, same as ZERODTE_COMMAND_RE's own documented
 * bare-token gap — this hint only fires when the wording actually points at THIS
 * scanner.
 */
export const ZERODTE_REJECTION_RE =
  /\b(near.?miss(es)?|gate.{0,15}reject(?:ed|ion)?|reject(?:ed|ion)?.{0,15}gate|gate.{0,15}fail(?:ed|s)?|fail(?:ed|s)?.{0,15}gate|didn'?t.{0,20}\b(?:make|hit)\b|wasn'?t.{0,20}\b(?:flagged|listed)\b|isn'?t.{0,20}\b(?:on|flagged)\b)\b.*\b(0.?dte|zero.?dte|grid)\b|\b(0.?dte|zero.?dte|grid)\b.*\b(near.?miss(es)?|gate.{0,15}reject(?:ed|ion)?|reject(?:ed|ion)?.{0,15}gate|gate.{0,15}fail(?:ed|s)?|fail(?:ed|s)?.{0,15}gate|didn'?t.{0,20}\b(?:make|hit)\b|wasn'?t.{0,20}\b(?:flagged|listed)\b|isn'?t.{0,20}\b(?:on|flagged)\b)\b/i;

/**
 * BlackOut Thermal's GEX regime/flip/wall-crossing HISTORY ("when did the flip
 * last cross," "how many times has the wall moved today," "has the gamma
 * regime flipped this session," "what's the wall history today") — hints
 * get_gex_regime_events (task #136), the durable transition log. Distinct from
 * get_positioning/get_gex's CURRENT-state-only snapshot: those tools have no
 * memory of what already happened earlier in the session, so a genuinely
 * retrospective/count question needs this tool instead. Three independent
 * ways to fire, each requiring an explicit domain token co-occurring with
 * retrospective/transition wording — same "REQUIRE co-occurrence, never fire
 * on the generic word alone" discipline ZERODTE_REJECTION_RE documents above
 * (a bare "how many times"/"when did"/"regime" is common phrasing for
 * countless unrelated questions, including this repo's OWN MARKET_REGIME_RE):
 *   1. A domain+history compound word pair ("flip/wall/regime/gex history") —
 *      self-sufficient on its own since the domain token IS part of the phrase.
 *   2. A GEX-specific two-word phrase (gamma flip / call wall / put wall / gex
 *      regime / gamma regime / dealer gamma) paired with a transition verb
 *      (crossed/broke/broken/flipped/moved/shifted) in either order.
 *   3. A generic retrospective/count trigger (when did / how many times / last
 *      cross) paired with a bare domain token (gamma flip/flip/gex/gamma/wall/
 *      call wall/put wall/regime) in either order.
 */
export const GEX_REGIME_HISTORY_RE =
  /\b(flip|wall|regime|gex)\s+history\b|\b(gamma flip|call wall|put wall|gex regime|gamma regime|dealer gamma)\b.{0,25}\b(cross(?:ed|ing)?|broke|broken|flipped|moved|shifted)\b|\b(cross(?:ed|ing)?|broke|broken|flipped|moved|shifted)\b.{0,25}\b(gamma flip|call wall|put wall|gex regime|gamma regime|dealer gamma)\b|\b(when did|how many times|last cross(?:ed)?)\b.{0,30}\b(gamma flip|flip|gex|gamma|wall|call wall|put wall|regime)\b|\b(gamma flip|flip|gex|gamma|wall|call wall|put wall|regime)\b.{0,30}\b(when did|how many times|last cross(?:ed)?)\b/i;

/**
 * HELIX flow-anomaly near-miss/rejection wording ("why didn't HELIX flag X,"
 * "near miss on the anomaly scan," "didn't trigger an anomaly," "below the
 * anomaly threshold") — hints get_flow_anomaly_near_misses (task #131), the
 * durable per-(ticker, anomaly_type) near-miss log for the market-regime-
 * detector's flow-anomaly scan. Deliberately REQUIRES co-occurrence with an
 * explicit "anomaly"/"anomalies"/"helix" token, same false-positive discipline
 * ZERODTE_REJECTION_RE uses (co-occurrence with 0dte/grid) — a bare "near miss"
 * or "didn't flag" alone is common phrasing for entirely unrelated questions (a
 * Night Hawk exclusion, a 0DTE Command rejection, a stop-loss near-touch) and
 * must not fire on its own. A bare "why didn't this fire" with no anomaly/HELIX
 * token stays unresolved on purpose, same as ZERODTE_REJECTION_RE's own
 * documented bare-token gap.
 *
 * Uses two independent lookaheads (order-agnostic), NOT the sequential
 * "phraseA.*tokenB | tokenB.*phraseA" shape ZERODTE_REJECTION_RE uses — the
 * natural phrasing here ("why didn't HELIX flag X") puts the product name
 * INSIDE the near-miss phrase itself (between "didn't" and "flag"), which a
 * sequential pattern can't match without letting one alternative's match
 * consume the very token the other alternative needs to see afterward.
 * Lookaheads sidestep that: each just needs to find its own pattern anywhere
 * in the question, independent of where the other one matched.
 */
export const FLOW_ANOMALY_NEAR_MISS_RE =
  /(?=.*\b(?:anomaly|anomalies|helix)\b)(?=.*\b(?:near.?miss(?:es)?|didn'?t.{0,25}\b(?:flag|catch|fire|trigger)\b|wasn'?t.{0,25}\b(?:flagged|caught|triggered)\b|below.{0,10}threshold|didn'?t.{0,15}(?:clear|hit).{0,10}threshold)\b)/i;

/**
 * Generic (ticker-independent) dealer-positioning/GEX language — "dealer
 * positioning," "gamma flip," "GEX walls," "call wall"/"put wall," "gamma
 * exposure," "net gex," "gamma/gex regime," "negative gamma" (task #140).
 * Vocabulary matches the domain GEX_REGIME_HISTORY_RE above already
 * establishes ("dealer gamma," "gamma regime," "gex regime") plus get_
 * positioning's own tool description ("net GEX," "negative-gamma flag,"
 * "wall summary").
 *
 * Why this needs its own regex rather than relying on SPX_DESK_TOOLS_RE's
 * existing bare "gamma"/"gex"/"dealer" tokens (tool-defs.ts's
 * getToolsForIntent): those tokens DO already fire on most of this
 * vocabulary and add TOOL_GROUPS.spx_desk (which carries get_gex and
 * get_gex_regime_events) — but get_positioning, BlackOut Thermal's own
 * "dealer positioning for ANY ticker" tool (the other half of
 * THERMAL_ENGINE_TOOL_NAMES), lives ONLY in TOOL_GROUPS.stock_analysis,
 * which getToolsForIntent gates behind mentionsTicker(). A ticker-less
 * question that is unambiguously GEX-flavored ("what's dealer positioning
 * look like," "where's the gamma flip," "show me the GEX walls") matches
 * SPX_DESK_TOOLS_RE and therefore never falls through to getToolsForIntent's
 * `names.size <= 2` CORE_TOOLS safety net either — that fallback is the ONLY
 * other path that would have accidentally included stock_analysis (and thus
 * get_positioning). Verified via a standalone getToolsForIntent() repro
 * before this fix: "where's the gamma flip" resolved get_gex and
 * get_gex_regime_events onto the allowlist but NOT get_positioning — the one
 * tool whose own description says it answers exactly that question — while a
 * question matching NO intent regex at all (e.g. "max pain today") got
 * get_positioning for free via the CORE_TOOLS fallback. Matching more
 * intent-shaped wording produced a WORSE (narrower, positioning-less) result
 * than matching nothing at all — the same class of inversion task #143 fixed
 * for NIGHTHAWK_RE's missing "edition" token.
 *
 * Deliberately includes "call wall"/"put wall" as standalone two-word phrases
 * even though they contain none of SPX_DESK_TOOLS_RE's bare tokens — the
 * task's own repro phrasings named them explicitly, and today they only
 * reach get_positioning via the same CORE_TOOLS fallback accident described
 * above (no other intent regex fires on them at all), so folding them into
 * this regex makes the routing intentional instead of incidental.
 */
export const GEX_POSITIONING_RE =
  /\b(dealer positioning|dealer gamma|gamma flip|gamma exposure|gamma regime|gex regime|net gex|negative gamma|gex walls?|gamma walls?|call wall|put wall)\b/;

export const SCREENER_RE = /\b(screener|squeeze|movers|breadth|sector)\b/;

export const FUNDAMENTAL_RE = /\b(fundamental|financial|insider|congress|analyst|institutional|predictions|smart money|whales)\b/;

export const PREDICTIONS_RE = /\b(predictions|prediction market|smart money|whales|insiders|consensus)\b/;

/** Night's Watch — the user asking about their OWN saved positions/book. */
export const MY_POSITIONS_RE =
  /\b(my|i'm holding|im holding|i am holding|i hold|i own|i bought)\b.*\b(position|positions|trade|trades|book|call|calls|put|puts|contract|contracts|holding|holdings)\b|\b(night'?s watch)\b/;

export function matchesIntent(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLowerCase());
}
