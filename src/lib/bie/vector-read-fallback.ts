// Side-effect-free honest fallback for the Vector desk read — extracted so it's unit-testable
// (composers.ts pulls the server-only provider graph and can't be imported in a plain test).
//
// When fetchVectorFullState returns null (no live spot — markets closed, cold matrix, or an
// off-universe ticker), composeVectorRead must return THIS honest message rather than null (which
// let the route 502 / fall back to an SPX desk-dump). Saying "I can't read this right now" is the
// correct behavior, never a crash.

/** Honest "no live Vector data" answer for a ticker. */
export function noLiveVectorStateMessage(ticker: string): string {
  const t = (ticker ?? "").toUpperCase().trim() || "that ticker";
  return (
    `I don't have live Vector data for **${t}** right now — the market may be closed, or there's ` +
    `no active options positioning I can read for it this moment. Try again during market hours, ` +
    `or ask about a ticker with live options flow.`
  );
}
