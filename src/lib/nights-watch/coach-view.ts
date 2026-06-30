// Pure decision logic for the Night's Watch "Position coach" region.
//
// The coach must be strictly grounded in the user's OWN open book. The underlying
// feed (/api/coaching/alerts → the global `coaching_alerts` table) is SPX-specific
// market coaching (walls / VWAP / long-short calls) that is identical for every
// premium session — it is NOT a per-position read. So it is only meaningful when
// the user is actually holding an SPX-family contract; otherwise it would surface
// market data unrelated to their positions (which reads as "random data").
//
// The rendering lives in NightsWatchPanel; this module is the single source of
// truth for the gating decision so it can be unit-tested in isolation.

const SPX_FAMILY = new Set(["SPX", "SPXW"]);

/** True when a ticker is an SPX-family root the SPX coaching feed actually covers. */
export function isSpxFamily(ticker: string | null | undefined): boolean {
  return ticker ? SPX_FAMILY.has(ticker.trim().toUpperCase()) : false;
}

/** True when any of the (open-position) tickers is an SPX-family contract. */
export function holdsSpxFamily(tickers: ReadonlyArray<string | null | undefined>): boolean {
  return tickers.some(isSpxFamily);
}

export type CoachView = "hidden" | "spx-alerts" | "position-note";

/**
 * Resolve what the Position coach region should render:
 *  - "hidden"        no open positions → nothing to coach; the catchy empty state stands alone.
 *  - "spx-alerts"    open SPX position → the SPX wall/VWAP coaching feed is relevant.
 *  - "position-note" open non-SPX position → per-card verdicts are the coaching; show a
 *                    position-grounded note instead of unrelated SPX market data.
 */
export function resolveCoachView(hasOpenPositions: boolean, holdsSpx: boolean): CoachView {
  if (!hasOpenPositions) return "hidden";
  return holdsSpx ? "spx-alerts" : "position-note";
}
