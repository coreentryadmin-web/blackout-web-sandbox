/** Default Vector chart symbol — SPX index options desk anchor. */
export const VECTOR_DEFAULT_TICKER = "SPX";

/** Index keys that use Polygon `I:` minute bars and SPX-style oracle WS when subscribed. */
export const VECTOR_INDEX_TICKERS = new Set(["SPX", "NDX", "RUT", "DJI", "VIX"]);

/** Tickers with UW `gex_strike_expiry` WS oracle (see UW_WS_GEX_STRIKE_EXPIRY_TICKERS). */
export const VECTOR_ORACLE_TICKERS = new Set(["SPX", "SPY", "QQQ"]);

const TICKER_RE = /^[A-Z0-9.\-]{1,8}$/;

/** Normalize and validate a user-facing Vector ticker key. Falls back to SPX on junk input.
 *  Accepts Polygon-style index keys ("I:SPX" → "SPX") so deep links survive. */
export function normalizeVectorTicker(raw: string | null | undefined): string {
  let t = String(raw ?? VECTOR_DEFAULT_TICKER).trim().toUpperCase();
  if (t.startsWith("I:")) t = t.slice(2);
  if (!TICKER_RE.test(t)) return VECTOR_DEFAULT_TICKER;
  return t;
}

export function isVectorIndexTicker(ticker: string): boolean {
  // normalizeVectorTicker strips any "I:" prefix, so the set lookup is total.
  return VECTOR_INDEX_TICKERS.has(normalizeVectorTicker(ticker));
}

/** Polygon aggregates symbol for minute-bar seed + live refresh. */
export function vectorPolygonMinuteSymbol(ticker: string): string {
  const t = normalizeVectorTicker(ticker);
  // Every VECTOR_INDEX_TICKERS member maps to its Polygon I: key — DJI was
  // missing, so ?ticker=DJI burned the 12-day walk-back with a bare "DJI"
  // symbol Polygon's index endpoint doesn't recognize and seeded nothing.
  if (VECTOR_INDEX_TICKERS.has(t)) return `I:${t}`;
  return t;
}

/** True when UW WS gex_strike_expiry ladder is expected for this ticker. */
export function vectorHasWsOracle(ticker: string): boolean {
  return VECTOR_ORACLE_TICKERS.has(normalizeVectorTicker(ticker));
}
