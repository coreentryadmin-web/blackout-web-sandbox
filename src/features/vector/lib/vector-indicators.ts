/**
 * Chart technical-indicator engine for Vector — pure, dependency-free series math behind the
 * opt-in (default-off) indicator overlays: VWAP, SMA, EMA, RSI, MACD. Every function returns an
 * array ALIGNED 1:1 with the input bars — `null` in the warm-up region where the indicator isn't
 * defined yet — so the chart layer can map straight to lightweight-charts line data (drop the
 * nulls) without re-indexing. Kept out of the component so the numerics are unit-tested directly
 * against known values.
 *
 * Standard definitions (TradingView-compatible): SMA = simple mean; EMA seeded from the SMA of the
 * first `period` values then k = 2/(period+1); VWAP = session-cumulative typical-price × volume;
 * RSI = Wilder's smoothing; MACD = EMA(fast) − EMA(slow) with an EMA(signal) of that line.
 */

export type IndicatorBar = { high: number; low: number; close: number; volume?: number };

/** Simple moving average aligned to `values`; null until `period` samples exist. */
export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average aligned to `values`. Seeded from the SMA of the first `period`
 * values (so out[period-1] is the seed), then recursively smoothed with k = 2/(period+1). Null
 * before the seed index.
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let ema = seed / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/**
 * Session-cumulative VWAP aligned to `bars`: Σ(typical×volume) / Σ(volume), typical = (H+L+C)/3.
 * Bars are assumed to be one session (the Vector chart's seed is one session), so accumulation
 * runs from the first bar. A bar with missing/zero volume contributes nothing but VWAP still
 * carries forward the running value; if NO bar up to i has volume, VWAP is null there (undefined
 * without volume — never silently substituted with price).
 */
export function vwapSeries(bars: IndicatorBar[]): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let cumTPV = 0;
  let cumVol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const vol = b.volume != null && b.volume > 0 ? b.volume : 0;
    if (vol > 0) {
      const typical = (b.high + b.low + b.close) / 3;
      cumTPV += typical * vol;
      cumVol += vol;
    }
    out[i] = cumVol > 0 ? cumTPV / cumVol : null;
  }
  return out;
}

/**
 * Wilder's RSI aligned to `closes`; null until index `period`. First avgGain/avgLoss are the
 * simple mean of the first `period` deltas, then Wilder-smoothed. RSI = 100 − 100/(1+RS); an
 * all-gains window (avgLoss 0) reads 100, all-losses reads 0.
 */
export function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period <= 0 || closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    if (delta >= 0) gainSum += delta;
    else lossSum -= delta;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    const gain = delta >= 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type MacdPoint = { macd: number | null; signal: number | null; histogram: number | null };

/**
 * MACD aligned to `closes`: macd = EMA(fast) − EMA(slow); signal = EMA(macd, signalPeriod) over
 * the defined macd region; histogram = macd − signal. Each field is null until its inputs exist
 * (macd from the slow EMA's seed; signal `signalPeriod` macd-points later).
 */
export function macdSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): MacdPoint[] {
  const out: MacdPoint[] = closes.map(() => ({ macd: null, signal: null, histogram: null }));
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);

  // macd line where BOTH EMAs are defined (slow is the binding constraint).
  const macd: (number | null)[] = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null
  );

  // Signal = EMA of the CONTIGUOUS defined macd values, then mapped back to their indices.
  const defined: { idx: number; val: number }[] = [];
  for (let i = 0; i < macd.length; i++) {
    if (macd[i] != null) defined.push({ idx: i, val: macd[i] as number });
  }
  const signalOnDefined = emaSeries(defined.map((d) => d.val), signalPeriod);

  for (let i = 0; i < macd.length; i++) out[i]!.macd = macd[i];
  for (let j = 0; j < defined.length; j++) {
    const sig = signalOnDefined[j];
    if (sig == null) continue;
    const idx = defined[j]!.idx;
    out[idx]!.signal = sig;
    out[idx]!.histogram = (defined[j]!.val) - sig;
  }
  return out;
}
