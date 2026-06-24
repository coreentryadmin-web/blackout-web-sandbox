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

export const SCREENER_RE = /\b(screener|squeeze|movers|breadth|sector)\b/;

export const FUNDAMENTAL_RE = /\b(fundamental|financial|insider|congress|analyst|institutional|predictions|smart money|whales)\b/;

export const PREDICTIONS_RE = /\b(predictions|prediction market|smart money|whales|insiders|consensus)\b/;

/** Night's Watch — the user asking about their OWN saved positions/book. */
export const MY_POSITIONS_RE =
  /\b(my|i'm holding|im holding|i am holding|i hold|i own|i bought)\b.*\b(position|positions|trade|trades|book|call|calls|put|puts|contract|contracts|holding|holdings)\b|\b(night'?s watch)\b/;

export function matchesIntent(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLowerCase());
}
