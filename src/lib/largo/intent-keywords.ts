/** Shared intent keyword patterns for Largo tool routing and question analysis. */

export const SPX_DESK_RE =
  /\b(spx|s&p 500|s&p|0dte|sniper|gamma flip|gex|dealer|max pain|vwap|hod|lod|pdh|pdl|internals|tick|trin)\b/;

export const SPX_DESK_TOOLS_RE = /\b(spx|s&p|play|signal|0dte|sniper|gamma|gex|dealer)\b/;

export const FLOW_RE =
  /\b(flow|sweep|whale|dark pool|tape|premium|unusual|sweeps|nope|tide)\b/;

export const FLOW_TOOLS_RE = /\b(flow|tape|sweep|whale|dark pool|premium|unusual)\b/;

export const PLAY_STATE_RE =
  /\b(buy|sell|hold|trim|play|setup|trade|lotto|signal|outlook|analysis)\b/;

export const NEWS_RE = /\b(news|headline|catalyst|earnings|cpi|fomc|macro|calendar)\b/;

export const NEWS_TOOLS_RE = /\b(earnings|news|catalyst|cpi|fomc|macro|calendar)\b/;

export const VOL_RE = /\b(iv|vol|vix|skew|rank|realized)\b/;

export const VOL_TOOLS_RE = /\b(vol|vix|iv|skew|rank)\b/;

export const NIGHTHAWK_RE =
  /\b(nighthawk|night hawk|playbook|tomorrow|evening plays|hawk plays|top plays|hawk)\b/;

export const SCREENER_RE = /\b(screener|squeeze|movers|breadth|sector)\b/;

export const FUNDAMENTAL_RE = /\b(fundamental|financial|insider|congress|analyst)\b/;

export function matchesIntent(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLowerCase());
}
