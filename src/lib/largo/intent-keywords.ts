/** Shared intent keyword patterns for Largo tool routing and question analysis. */

export const SPX_DESK_RE =
  /\b(spx|s&p 500|s&p|0dte|sniper|gamma flip|gex|dealer|max pain|vwap|hod|lod|pdh|pdl|internals|tick|trin|greek flow|dealer gamma|mag7|mag 7|mega.?cap)\b/;

export const SPX_DESK_TOOLS_RE = /\b(spx|s&p|play|signal|0dte|sniper|gamma|gex|dealer|greek flow|mag7|mag 7)\b/;

export const FLOW_RE =
  /\b(flow|sweep|whale|dark pool|tape|premium|unusual|sweeps|nope|tide)\b/;

export const FLOW_TOOLS_RE = /\b(flow|tape|sweep|whale|dark pool|premium|unusual)\b/;

export const PLAY_STATE_RE =
  /\b(spx|s&p|0dte|sniper|lotto)\b.*\b(buy|sell|hold|trim|play|setup|signal)\b|\b(play state|open play|desk play)\b/i;

export const NEWS_RE = /\b(news|headline|catalyst|earnings|cpi|fomc|macro|calendar|gdp|unemployment|inflation)\b/;

export const NEWS_TOOLS_RE = /\b(earnings|news|catalyst|cpi|fomc|macro|calendar|gdp|unemployment|inflation)\b/;

export const VOL_RE = /\b(iv|vol|vix|skew|rank|realized)\b/;

export const VOL_TOOLS_RE = /\b(vol|vix|iv|skew|rank)\b/;

export const NIGHTHAWK_RE =
  /\b(nighthawk|night hawk|playbook|tomorrow|evening plays|hawk plays|top plays|hawk)\b/;

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
 * command," "hunt(er)," "scan(ner)," or "find(s)" paired with 0dte) gets an
 * EXTRA, stronger hint toward get_zerodte_plays instead of relying on the same
 * ambiguous bare token both engines already share (task #127).
 */
export const ZERODTE_COMMAND_RE =
  /\b(0dte command|zero.?dte command|command board|grid scanner|grid board|blackout grid|across tickers|multi.?ticker|fresh finds?)\b|\b(scan|scans|scanning|scanner|hunt|hunts|hunting|hunter)\b|\b(find|finds|finding)\b.*\b(0.?dte|zero.?dte)\b|\b(0.?dte|zero.?dte)\b.*\b(find|finds|finding)\b/i;

export const SCREENER_RE = /\b(screener|squeeze|movers|breadth|sector)\b/;

export const FUNDAMENTAL_RE = /\b(fundamental|financial|insider|congress|analyst|institutional|predictions|smart money|whales)\b/;

export const PREDICTIONS_RE = /\b(predictions|prediction market|smart money|whales|insiders|consensus)\b/;

/** Night's Watch — the user asking about their OWN saved positions/book. */
export const MY_POSITIONS_RE =
  /\b(my|i'm holding|im holding|i am holding|i hold|i own|i bought)\b.*\b(position|positions|trade|trades|book|call|calls|put|puts|contract|contracts|holding|holdings)\b|\b(night'?s watch)\b/;

export function matchesIntent(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLowerCase());
}
