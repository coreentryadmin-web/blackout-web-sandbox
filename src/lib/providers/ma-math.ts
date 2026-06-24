// Pure moving-average math (no imports) so it is unit-testable and reusable. Used as the FALLBACK
// for index moving averages. Massive's documented indices indicator endpoints
// (/v1/indicators/{sma,ema}/{I:TICKER}, "Included in all Indices plans") DO support index tickers
// and are PRIMARY in polygon.ts; this computes the MA from aggregate bars only when the endpoint
// momentarily returns null (a transient Massive blip). NOTE: an earlier version of this comment
// wrongly claimed indices were unsupported — that was the RT-5 misread (inferred from a code
// comment instead of the docs); corrected after verifying the official Massive docs.

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
