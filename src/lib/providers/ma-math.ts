// Pure moving-average math (no imports) so it is unit-testable and reusable. Used to derive
// INDEX moving averages from aggregate bars, because Polygon's /v1/indicators/{ema,sma} endpoints
// do NOT support index tickers (e.g. I:SPX) and return "Request failed" — while index aggregate
// bars work fine (same reason index VWAP is derived from bars).

/** Simple moving average of the last `window` closes. Null when there aren't enough bars. */
export function smaFromCloses(closes: number[], window: number): number | null {
  if (window <= 0 || closes.length < window) return null;
  const slice = closes.slice(-window);
  let sum = 0;
  for (const c of slice) sum += c;
  return sum / window;
}

/**
 * Exponential moving average. Closes MUST be oldest→newest. Seeded with the SMA of the first
 * `window` closes, then iterated forward — fed enough history this converges to within a
 * fraction of a percent of the canonical (infinite-history) EMA. Null when there aren't enough
 * bars.
 */
export function emaFromCloses(closes: number[], window: number): number | null {
  if (window <= 0 || closes.length < window) return null;
  const k = 2 / (window + 1);
  let seed = 0;
  for (let i = 0; i < window; i++) seed += closes[i];
  let ema = seed / window;
  for (let i = window; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}
