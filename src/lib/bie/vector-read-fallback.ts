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

/**
 * The desk scopes dealer positioning to exactly four horizons — 0DTE / weekly / monthly / full-chain
 * ("all"). A question that names a LEAP, a multi-year, quarterly, or multi-month horizon is NOT
 * representable: `extractHorizon`/`normalizeDteHorizon` would silently collapse it to "all" and the
 * desk would answer the whole-chain aggregate AS IF it satisfied the request — a fabricated read.
 * This detector lets the composer reject it honestly instead. Deliberately does NOT match "monthly"
 * (supported) or "1 month" (≈monthly); only 2+ months, years, LEAPs, quarterly, annual.
 */
const UNSUPPORTED_HORIZON_RE =
  /\bleaps?\b|\bmulti[-\s]?year\b|\b\d+\s*[-\s]?(year|yr)s?\b|\bannual(?:ly)?\b|\bquarterly\b|\bquarter\b|\bhalf[-\s]?year\b|\b(?:[2-9]|1[0-9])\s*[-\s]?months?\b/i;

/** True when the question names a horizon the Vector/SPX desks cannot scope (LEAP/multi-year/etc.). */
export function namesUnsupportedHorizon(question: string): boolean {
  return !!question && UNSUPPORTED_HORIZON_RE.test(question);
}

/** Honest "that horizon isn't supported" answer — never a fabricated whole-chain read. */
export function unsupportedHorizonMessage(ticker: string): string {
  const t = (ticker ?? "").toUpperCase().trim() || "that ticker";
  return (
    `I can only scope dealer positioning to **0DTE, weekly, monthly, or the full chain** for **${t}** — ` +
    `I can't isolate a multi-year / LEAP horizon, so I won't guess one from the whole-chain aggregate. ` +
    `Ask for the 0DTE, weekly, monthly, or full-chain flip / walls / max pain instead.`
  );
}
