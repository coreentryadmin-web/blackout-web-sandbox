// Intraday edge layer — the "is this working RIGHT NOW" read a 0DTE scalper
// actually trades from: today's session VWAP, the opening range and which side
// price broke it, the last-15-minutes trend — computed from the name's own minute
// bars. The same read on SPY doubles as the market-alignment signal (don't fight
// the tape), and a time-of-day factor encodes the known 0DTE edge windows.
// Pure functions only; the scan does the fetching.

import { etMinutesOf } from "./plan";

export type IntradayBar = { t: number; h: number; l: number; c: number; v?: number };

export type IntradayRead = {
  /** Today's session VWAP (typical-price, volume-weighted; RTH bars only). */
  vwap: number | null;
  /** Last price vs VWAP, % — positive = above. */
  vwap_dist_pct: number | null;
  /** First-30-minutes range. */
  or_high: number | null;
  or_low: number | null;
  /** Where price sits vs the opening range right now. */
  or_break: "above" | "below" | "inside" | null;
  /** Trend of the last ~15 minutes of closes. */
  trend_5m: "up" | "down" | "flat";
  last: number | null;
  day_high: number | null;
  day_low: number | null;
  /** Epoch-ms of the newest RTH bar in the read — how FRESH this read actually is.
   *  The G-1 tape-alignment gate (./gates.ts) fails closed on a stale SPY read: a
   *  bias computed from bars that stopped arriving isn't a bias, it's a memory. */
  last_bar_ms: number | null;
};

const RTH_OPEN = 9 * 60 + 30;
const OR_END = 10 * 60; // opening range = first 30 minutes

/** Compute the intraday read from a session's minute bars (any order; non-RTH
 *  bars are ignored). Empty/absent RTH data → nulls, never a guess. */
export function computeIntradayRead(bars: IntradayBar[]): IntradayRead {
  const rth = bars
    .filter((b) => Number.isFinite(b.t) && etMinutesOf(b.t) >= RTH_OPEN)
    .sort((a, b) => a.t - b.t);
  if (rth.length === 0) {
    return {
      vwap: null,
      vwap_dist_pct: null,
      or_high: null,
      or_low: null,
      or_break: null,
      trend_5m: "flat",
      last: null,
      day_high: null,
      day_low: null,
      last_bar_ms: null,
    };
  }

  let pv = 0;
  let vol = 0;
  let orHigh: number | null = null;
  let orLow: number | null = null;
  let dayHigh = -Infinity;
  let dayLow = Infinity;
  for (const b of rth) {
    const typical = (b.h + b.l + b.c) / 3;
    const v = b.v && b.v > 0 ? b.v : 1; // volume-less bars fall back to equal weight
    pv += typical * v;
    vol += v;
    dayHigh = Math.max(dayHigh, b.h);
    dayLow = Math.min(dayLow, b.l);
    if (etMinutesOf(b.t) < OR_END) {
      orHigh = Math.max(orHigh ?? -Infinity, b.h);
      orLow = Math.min(orLow ?? Infinity, b.l);
    }
  }
  const last = rth[rth.length - 1]!.c;
  const vwap = vol > 0 ? pv / vol : null;
  const vwapDist = vwap != null && vwap > 0 ? Math.round(((last - vwap) / vwap) * 10000) / 100 : null;

  let orBreak: IntradayRead["or_break"] = null;
  if (orHigh != null && orLow != null) {
    orBreak = last > orHigh ? "above" : last < orLow ? "below" : "inside";
  }

  // Last ~15 one-minute closes: net move beyond ±0.05% = a trend, else flat.
  const tail = rth.slice(-15);
  let trend: IntradayRead["trend_5m"] = "flat";
  if (tail.length >= 5) {
    const movePct = ((tail[tail.length - 1]!.c - tail[0]!.c) / tail[0]!.c) * 100;
    trend = movePct > 0.05 ? "up" : movePct < -0.05 ? "down" : "flat";
  }

  return {
    vwap: vwap != null ? Math.round(vwap * 100) / 100 : null,
    vwap_dist_pct: vwapDist,
    or_high: orHigh != null ? Math.round(orHigh * 100) / 100 : null,
    or_low: orLow != null ? Math.round(orLow * 100) / 100 : null,
    or_break: orBreak,
    trend_5m: trend,
    last,
    day_high: Number.isFinite(dayHigh) ? Math.round(dayHigh * 100) / 100 : null,
    day_low: Number.isFinite(dayLow) ? Math.round(dayLow * 100) / 100 : null,
    last_bar_ms: rth[rth.length - 1]!.t,
  };
}

export type IntradayAdjust = {
  /** Score delta from intraday confirmation/conflict. */
  delta: number;
  /** Hard conflict: price on the WRONG side of VWAP and the short-term trend
   *  against the play — an A-tier disqualifier, not just a score dent. */
  conflict: boolean;
};

/** How the name's own intraday tape confirms or fights the play's direction. */
export function intradayScoreAdjust(direction: "long" | "short", read: IntradayRead | null): IntradayAdjust {
  if (!read || read.last == null || read.vwap == null) return { delta: 0, conflict: false };
  const above = read.last > read.vwap;
  const withPlay = direction === "long" ? above : !above;
  const trendWith =
    read.trend_5m === "flat" ? null : (read.trend_5m === "up") === (direction === "long");
  const orWith =
    read.or_break == null || read.or_break === "inside"
      ? null
      : (read.or_break === "above") === (direction === "long");

  let delta = 0;
  if (withPlay) delta += 4;
  else delta -= 6;
  if (orWith === true) delta += 4;
  else if (orWith === false) delta -= 4;
  if (trendWith === true) delta += 2;
  else if (trendWith === false) delta -= 2;

  return { delta, conflict: !withPlay && trendWith === false };
}

export type MarketBias = "up" | "down" | "flat";

/** Market direction from SPY's own intraday read — VWAP side breaks ties with trend. */
export function marketBias(spy: IntradayRead | null): MarketBias | null {
  if (!spy || spy.last == null || spy.vwap == null) return null;
  const above = spy.last > spy.vwap;
  if (spy.trend_5m === "up" && above) return "up";
  if (spy.trend_5m === "down" && !above) return "down";
  if (Math.abs(spy.vwap_dist_pct ?? 0) < 0.1) return "flat";
  return above ? "up" : "down";
}

/** Alignment of a play with the market tape: with it +4, against it −6, flat 0. */
export function marketAlignAdjust(direction: "long" | "short", bias: MarketBias | null): number {
  if (bias == null || bias === "flat") return 0;
  const withMarket = (bias === "up") === (direction === "long");
  return withMarket ? 4 : -6;
}

export type TimeOfDayFactor = {
  delta: number;
  /** Short label for the intel line (e.g. "prime window", "lunch chop"). */
  label: string | null;
};

/** The known 0DTE edge windows: opening chop → prime morning drive → lunch chop →
 *  afternoon trend window. Fresh entries after 15:00 are already blocked upstream. */
export function timeOfDayFactor(etMinutes: number): TimeOfDayFactor {
  if (etMinutes < RTH_OPEN) return { delta: 0, label: null };
  if (etMinutes < 9 * 60 + 50) return { delta: -5, label: "opening chop — ranges still forming" };
  if (etMinutes < 11 * 60) return { delta: 5, label: "prime morning window" };
  if (etMinutes < 13 * 60 + 30) return { delta: -5, label: "lunch chop — fake-out hours, size down" };
  if (etMinutes < 14 * 60) return { delta: 0, label: null };
  if (etMinutes < 15 * 60) return { delta: 3, label: "afternoon trend window" };
  return { delta: 0, label: null };
}
