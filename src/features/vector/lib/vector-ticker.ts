/** Default Vector chart symbol — SPX index options desk anchor. */
export const VECTOR_DEFAULT_TICKER = "SPX";

/** Index keys that use Polygon `I:` minute bars and SPX-style oracle WS when subscribed. */
export const VECTOR_INDEX_TICKERS = new Set(["SPX", "NDX", "RUT", "DJI", "VIX"]);

/** Tickers with UW `gex_strike_expiry` WS oracle (see UW_WS_GEX_STRIKE_EXPIRY_TICKERS). */
export const VECTOR_ORACLE_TICKERS = new Set(["SPX", "SPY", "QQQ"]);

const TICKER_RE = /^[A-Z0-9.\-]{1,8}$/;

/** Normalize and validate a user-facing Vector ticker key. Falls back to SPX on junk input. */
export function normalizeVectorTicker(raw: string | null | undefined): string {
  const t = String(raw ?? VECTOR_DEFAULT_TICKER).trim().toUpperCase();
  if (!TICKER_RE.test(t)) return VECTOR_DEFAULT_TICKER;
  return t;
}

export function isVectorIndexTicker(ticker: string): boolean {
  const t = normalizeVectorTicker(ticker);
  return VECTOR_INDEX_TICKERS.has(t) || t.startsWith("I:");
}

/** Polygon aggregates symbol for minute-bar seed + live refresh. */
export function vectorPolygonMinuteSymbol(ticker: string): string {
  const t = normalizeVectorTicker(ticker);
  if (t === "SPX") return "I:SPX";
  if (t === "NDX") return "I:NDX";
  if (t === "RUT") return "I:RUT";
  if (t === "VIX") return "I:VIX";
  if (t.startsWith("I:")) return t;
  return t;
}

/** True when UW WS gex_strike_expiry ladder is expected for this ticker. */
export function vectorHasWsOracle(ticker: string): boolean {
  return VECTOR_ORACLE_TICKERS.has(normalizeVectorTicker(ticker));
}
