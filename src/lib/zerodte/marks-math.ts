// Pure math for the 0DTE live-marks lane (B-9) — dependency-free leaf (only
// plan.ts constants/state machine) so the board service, the SSE lane, and the
// client can all share ONE derivation of every displayed number without pulling
// the impure lane (db/providers/ws) into their import graphs or tests.
//
// The correctness rules live here as CODE, not advice:
//  - resolveZeroDteMark: mid is the mark; last-trade only as a FLAGGED fallback;
//    a prior-session close is never a live mark.
//  - pinnedLivePnlPct: the ONE P&L formula, always against the PINNED ledger
//    entry premium.
//  - closedStopReason: a stopped play's result is the stop P&L (matches the
//    post-session grader), never a frozen last_mark.
//  - advancePlayLatch: the same latch + derivePlayStatus state machine the
//    scanner sync uses, as a pure function of (prior latch, mark, clock).

import { derivePlayStatus, PLAN_RULES, type PlayStatus } from "./plan";

/** Hard cap on contracts in the live lane — open ledger plays only, never a chain. */
export const ZERODTE_LIVE_CONTRACT_CAP = 16;

/** A mark older than this must be rendered as STALE by every consumer (ms). */
export const ZERODTE_MARK_STALE_MS = 5_000;

export type ZeroDteMarkSource = "mid" | "last" | "none";

/** Mid of bid/ask — IDENTICAL guard to the chain/WS midOf (ask>0 = a real quote,
 *  bid may be 0 for deep-OTM). */
export function zeroDteMidOf(bid: number | null, ask: number | null): number | null {
  if (bid != null && ask != null && ask > 0 && bid >= 0) {
    return Number(((bid + ask) / 2).toFixed(4));
  }
  return null;
}

/**
 * Resolve the DISPLAY mark with provenance: mid when a two-sided quote exists,
 * else the last trade FLAGGED as such, else none. Deliberately excludes the
 * unified snapshot's dayClose tier — a prior-session close rendered as a live
 * mark is the exact wrong-number class this lane exists to kill (D-2 in
 * docs/audit/ZERODTE-DATA-PATH-AUDIT.md).
 */
export function resolveZeroDteMark(
  bid: number | null,
  ask: number | null,
  last: number | null
): { mark: number | null; source: ZeroDteMarkSource } {
  const mid = zeroDteMidOf(bid, ask);
  if (mid != null && mid > 0) return { mark: mid, source: "mid" };
  if (last != null && last > 0) return { mark: last, source: "last" };
  return { mark: null, source: "none" };
}

/**
 * THE P&L derivation — premium P&L % of `mark` against the PINNED entry premium.
 * Single source of truth: zerodte-service's board rows, the SSE lane, and any
 * future consumer must import this, never re-implement it (pre-B-9 the board had
 * this exact formula duplicated privately in zerodte-service.ts). Rounding
 * matches derivePlayStatus (plan.ts): 2dp via ×10000/100.
 */
export function pinnedLivePnlPct(entryPremium: number | null, mark: number | null): number | null {
  if (entryPremium == null || entryPremium <= 0 || mark == null) return null;
  return Math.round(((mark - entryPremium) / entryPremium) * 10000) / 100;
}

/** Staleness predicate every renderer must apply (>ZERODTE_MARK_STALE_MS = dim). */
export function isZeroDteMarkStale(
  asOfMs: number,
  nowMs: number,
  staleAfterMs = ZERODTE_MARK_STALE_MS
): boolean {
  return !(asOfMs > 0) || nowMs - asOfMs > staleAfterMs;
}

/**
 * D-1 fix (wrong frozen P&L on stopped plays): a CLOSED row whose latched trough
 * crossed the −50% stop is a STOPPED play — its result is the stop P&L by the
 * plan's own methodology (gradePlanFromBars exits AT the stop), not whatever
 * last_mark happened to freeze at when the row closed. Order matches
 * derivePlayStatus: a peak that tagged the +100% target first makes TRIM sticky,
 * so such a row is never relabeled "stopped". Returns null for everything else
 * (live rows, time-stop closes) — those correctly show mark-derived P&L.
 */
export function closedStopReason(row: {
  status: string | null;
  entry_premium: number | null;
  peak_premium: number | null;
  trough_premium: number | null;
}): "stopped" | null {
  const entry = row.entry_premium;
  if (row.status !== "CLOSED" || entry == null || entry <= 0) return null;
  const target = entry * (1 + PLAN_RULES.target_pct / 100);
  const stop = entry * (1 + PLAN_RULES.stop_pct / 100);
  if (row.peak_premium != null && row.peak_premium >= target) return null; // TRIM was sticky first
  if (row.trough_premium != null && row.trough_premium <= stop) return "stopped";
  return null;
}

/** The displayed P&L for a board ledger row: a stopped play pins to the stop P&L
 *  (the number the grader will stamp), everything else derives from the mark. */
export function ledgerDisplayPnlPct(row: {
  status: string | null;
  entry_premium: number | null;
  last_mark: number | null;
  peak_premium: number | null;
  trough_premium: number | null;
}): number | null {
  if (closedStopReason(row) === "stopped") return PLAN_RULES.stop_pct;
  return pinnedLivePnlPct(row.entry_premium, row.last_mark);
}

export type PlayLatch = {
  peak: number | null;
  trough: number | null;
  status: PlayStatus;
};

/**
 * Advance one play's latched lifecycle from a fresh mark — the SAME peak/trough
 * latch + derivePlayStatus state machine syncLedgerLiveState (scan.ts) applies,
 * expressed as a pure function of (prior latch, mark, clock) so the 1s lane and
 * its tests never need a database. Latches only widen; a null mark advances the
 * clock (time stop) without touching the latches.
 */
export function advancePlayLatch(
  play: { entry_premium: number | null; peak_premium: number | null; trough_premium: number | null },
  prior: PlayLatch | null,
  mark: number | null,
  nowEtMinutes: number
): PlayLatch {
  const entry = play.entry_premium;
  const seedPeak = prior?.peak ?? play.peak_premium ?? entry ?? null;
  const seedTrough = prior?.trough ?? play.trough_premium ?? entry ?? null;
  const peak = mark != null ? (seedPeak != null ? Math.max(seedPeak, mark) : mark) : seedPeak;
  const trough = mark != null ? (seedTrough != null ? Math.min(seedTrough, mark) : mark) : seedTrough;
  const state = derivePlayStatus({
    entryPremium: entry,
    mark,
    peak,
    trough,
    nowEtMinutes,
  });
  return { peak, trough, status: state.status };
}
