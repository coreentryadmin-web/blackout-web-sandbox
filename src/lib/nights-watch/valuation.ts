// Night's Watch valuation — PURE functions over an already-fetched options chain.
// Upstream fetching + caching live in lib/nights-watch/chain-cache.ts; this file
// never touches the network, so it can never be the per-user upstream-call hot path.
//
// NEVER fabricates a price: when no usable price exists on the matched contract,
// valuationFromContract() returns null and enrichPosition() reports 'unavailable'.

import type { ChainContract } from "@/lib/providers/polygon-options-gex";
import type { OptionSnapshot } from "@/lib/providers/options-snapshot";
import { todayEt } from "@/lib/et-date";
import type { UserPositionRow } from "@/lib/db";

/**
 * Where the live `mark` came from:
 *  - 'ws'       — fresh Massive options WebSocket quote (real-time bid/ask mid)
 *  - 'snapshot' — cached REST chain snapshot (mid/last/close)
 *  - 'none'     — no usable price anywhere (paired with a null valuation)
 * Never fabricated: a mark always traces to one of the first two sources.
 */
export type MarkSource = "ws" | "snapshot" | "none";

export type ContractValuation = {
  mark: number;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  iv: number | null;
  openInterest: number | null;
  underlyingPrice: number | null;
  mark_source: MarkSource;
  /**
   * Freshness stamp for THIS mark (mirrors flow_data_age_ms on the desk):
   *  - For a live WS mark it is the quote timestamp (liveMark.ts).
   *  - For a snapshot/day-close mark there is no per-field timestamp inside this PURE
   *    function, so it is null and the caller stamps `refreshedAt` from the snapshot/cache
   *    age it owns. The UI grays-out / age-badges anything it cannot prove is live.
   * Keeps the value REAL but lets the surface mark it not-live (truth mandate).
   * OPTIONAL so existing literal constructors (e.g. tests) stay compile-valid; the
   * valuers in this file always populate it.
   */
  refreshedAt?: number | null;
  /**
   * True when the resolved mark is the prior session's day/session close (the lowest
   * price tier) — a REAL but DAY-OLD value. The UI must label it 'prior close' and must
   * NOT present the derived current_value / unrealized_pnl as a live intraday figure.
   * OPTIONAL for the same compat reason; the valuers always populate it.
   */
  mark_is_day_close?: boolean;
};

/**
 * A fresh live WS mark for the contract, when one is available. bid/ask may be
 * null even with a usable mid (the engine only requires ask>0). Greeks/IV/OI are
 * NOT carried here — the WS Q feed doesn't provide them; they stay from the snapshot.
 */
export type LiveMark = {
  mark: number;
  bid: number | null;
  ask: number | null;
  ts: number;
};

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type MarkInputs = {
  bid: number | null;
  ask: number | null;
  last: number | null;
  dayClose: number | null;
};

/**
 * THE single price-ladder, used by BOTH the chain valuer and the unified-snapshot valuer, so
 * the two sources produce an IDENTICAL mark for the same Massive inputs (no drift, by
 * construction). Priority:
 *   1. fresh live WS mark (real-time mid) — and prefer its bid/ask too
 *   2. mid(bid,ask)  [ask>0 && bid>=0 — bid may be 0 deep-OTM; ask>0 keeps it a real two-sided quote]
 *   3. last trade (>0)
 *   4. day / session close (>0)
 * Returns null (→ mark_source 'none') when no usable price exists — NEVER a fabricated value.
 */
function resolveMark(
  inputs: MarkInputs,
  liveMark?: LiveMark | null
): {
  mark: number;
  bid: number | null;
  ask: number | null;
  mark_source: MarkSource;
  /** Quote timestamp when the mark came from a live WS quote; null otherwise. */
  refreshedAt: number | null;
  /** The mark is the prior session's day/session close (real but day-old). */
  mark_is_day_close: boolean;
} | null {
  let bid = inputs.bid;
  let ask = inputs.ask;
  let mark: number | null = null;
  // mark_source stays the EXISTING 3-value union ('ws' | 'snapshot' | 'none') so downstream
  // consumers + tests are unchanged. Day-old-ness is surfaced via the ADDITIVE flag below.
  let mark_source: MarkSource = "none";
  let refreshedAt: number | null = null;
  let mark_is_day_close = false;

  if (liveMark && Number.isFinite(liveMark.mark) && liveMark.mark >= 0) {
    mark = liveMark.mark;
    mark_source = "ws";
    refreshedAt = Number.isFinite(liveMark.ts) ? liveMark.ts : null;
    if (liveMark.bid != null) bid = liveMark.bid;
    if (liveMark.ask != null) ask = liveMark.ask;
  } else if (inputs.bid != null && inputs.ask != null && inputs.ask > 0 && inputs.bid >= 0) {
    mark = (inputs.bid + inputs.ask) / 2;
    mark_source = "snapshot";
  } else if (inputs.last != null && inputs.last > 0) {
    mark = inputs.last;
    mark_source = "snapshot";
  } else if (inputs.dayClose != null && inputs.dayClose > 0) {
    // Lowest price tier: a REAL but DAY-OLD prior-session close. Flag it so the surface
    // labels it 'prior close' and never shows the derived P&L as a live intraday figure.
    mark = inputs.dayClose;
    mark_source = "snapshot";
    mark_is_day_close = true;
  }
  if (mark == null || !(mark >= 0)) return null;
  return { mark: Number(mark.toFixed(4)), bid, ask, mark_source, refreshedAt, mark_is_day_close };
}

/**
 * Extract mark + greeks from a chain contract already matched by chain-cache.
 * PRICE PRIORITY:
 *   1. fresh live WS mark (`liveMark`) — real-time bid/ask mid, when present
 *   2. snapshot mid of bid/ask
 *   3. snapshot last trade
 *   4. snapshot day close
 * Greeks/IV/OI/underlying ALWAYS come from the snapshot (the WS Q feed has none).
 * Returns null + would report mark_source 'none' when no usable price exists
 * (never a fabricated value).
 */
export function valuationFromContract(
  contract: ChainContract,
  spot: number,
  liveMark?: LiveMark | null
): ContractValuation | null {
  const resolved = resolveMark(
    {
      bid: finiteOrNull(contract.last_quote?.bid),
      ask: finiteOrNull(contract.last_quote?.ask),
      last: finiteOrNull(contract.last_trade?.price),
      dayClose: finiteOrNull(contract.day?.close),
    },
    liveMark
  );
  if (!resolved) return null;
  const { mark, bid, ask, mark_source, refreshedAt, mark_is_day_close } = resolved;

  const up = finiteOrNull(contract.underlying_asset?.price) ?? (spot > 0 ? spot : null);

  return {
    mark,
    bid,
    ask,
    delta: finiteOrNull(contract.greeks?.delta),
    gamma: finiteOrNull(contract.greeks?.gamma),
    theta: finiteOrNull(contract.greeks?.theta),
    iv: finiteOrNull(contract.implied_volatility),
    openInterest: finiteOrNull(contract.open_interest),
    underlyingPrice: up != null && up > 0 ? up : null,
    mark_source,
    refreshedAt,
    mark_is_day_close,
  };
}

/**
 * Extract mark + greeks from a Massive UNIFIED-SNAPSHOT contract (per-OCC), already keyed
 * by OCC in the per-OCC cache. This is the SAME data the chain contract carries — the
 * snapshot returns the identical Massive fields (greeks/last_quote/iv/oi/underlying) — so
 * a valuation built here equals the chain valuation by construction (same inputs, same
 * priority, same rounding). It is a FETCH OPTIMIZATION, not a valuation-logic change.
 *
 * PRICE PRIORITY (identical to valuationFromContract):
 *   1. fresh live WS mark (`liveMark`) — real-time bid/ask mid, when present
 *   2. snapshot resolved mark (`snap.mark` = midpoint ?? mid(bid,ask) ?? last_trade)
 * Greeks/IV/OI/underlying ALWAYS come from the snapshot (the WS Q feed has none), exactly
 * like the chain path. Returns null (→ mark_source 'none') when no usable price exists —
 * NEVER a fabricated value.
 */
export function valuationFromSnapshot(
  snap: OptionSnapshot,
  liveMark?: LiveMark | null
): ContractValuation | null {
  // Resolve through the SAME shared ladder as the chain (resolveMark) using the snapshot's RAW
  // bid/ask/last/dayClose — so a snapshot-served valuation is byte-identical to a chain-served
  // one for the same Massive data: no provider-midpoint-first divergence (C2), and the day-close
  // tier is present on both paths (C1). Greeks/IV/OI/underlying come from the snapshot.
  const resolved = resolveMark(
    {
      bid: finiteOrNull(snap.bid),
      ask: finiteOrNull(snap.ask),
      last: finiteOrNull(snap.last),
      dayClose: finiteOrNull(snap.dayClose),
    },
    liveMark
  );
  if (!resolved) return null;
  const { mark, bid, ask, mark_source, refreshedAt, mark_is_day_close } = resolved;

  const up = snap.underlyingPrice != null && snap.underlyingPrice > 0 ? snap.underlyingPrice : null;

  return {
    mark,
    bid,
    ask,
    delta: finiteOrNull(snap.delta),
    gamma: finiteOrNull(snap.gamma),
    theta: finiteOrNull(snap.theta),
    iv: finiteOrNull(snap.iv),
    openInterest: finiteOrNull(snap.openInterest),
    underlyingPrice: up,
    mark_source,
    refreshedAt,
    mark_is_day_close,
  };
}

export type ValuationStatus = "live" | "unavailable" | "pending";

/**
 * WHY a valuation is unavailable, so the surface can say something true instead of a bare
 * "unavailable". The caller (enrichment.ts) supplies the hint it learned while resolving:
 *  - 'contract-not-found' — neither the per-OCC snapshot nor the chain had the contract. The
 *    usual cause is an UNLISTED / non-existent contract (e.g. a strike/expiry that doesn't
 *    trade) — NOT a system fault. Matches the standing note that unlisted ≠ bug.
 *  - 'no-quote'           — the contract WAS found but carried no usable price on any tier
 *    (no two-sided quote, no last trade, no prior close) — e.g. an illiquid contract.
 *  - 'market-closed'      — resolved off-hours with nothing cached yet; values resume at the open.
 *  - 'pending'            — just created; the live value lands on the next GET (paired with the
 *    'pending' status, not 'unavailable').
 *  - 'unknown'            — no hint was supplied (back-compat default).
 */
export type ValuationUnavailableReason =
  | "contract-not-found"
  | "no-quote"
  | "market-closed"
  | "pending"
  | "unknown";

export type EnrichedPosition = UserPositionRow & {
  valuation_status: ValuationStatus;
  /**
   * When valuation_status is NOT 'live', a machine-readable reason WHY (see
   * ValuationUnavailableReason) so the surface can label it truthfully — e.g. distinguish an
   * UNLISTED contract ('contract-not-found') from an illiquid one with no quote ('no-quote') or
   * an off-hours read ('market-closed'). Null when the valuation IS live. OPTIONAL so existing
   * literal constructors stay compile-valid; enrichPosition always sets it.
   */
  valuation_unavailable_reason?: ValuationUnavailableReason | null;
  valuation: ContractValuation | null;
  current_value: number | null;
  unrealized_pnl: number | null;
  pnl_pct: number | null;
  /**
   * Realized P&L (dollars) for a CLOSED position with a recorded exit_premium:
   * (exit_premium − entry_premium) × contracts × 100 × sideSign. Null while the
   * position is OPEN or no exit price is on record. Mirrors the unrealized_pnl
   * sign convention (long +1 / short −1). OPTIONAL so existing literal
   * constructors stay compile-valid; enrichPosition always sets it.
   */
  realized_pnl?: number | null;
  /**
   * Realized P&L as a percent of the entry cost (|entry_premium × contracts × 100|),
   * matching the unrealized pnl_pct denominator convention. Null while OPEN, with no
   * exit on record, or when entry_premium is 0 (undefined denominator). OPTIONAL.
   */
  realized_pnl_pct?: number | null;
  dte: number;
  breakeven: number | null;
  pct_to_breakeven: number | null;
  distance_to_strike_pct: number | null;
  /**
   * Age (ms) of the mark current_value / unrealized_pnl are derived from, when known.
   * Mirrors the desk's flow_data_age_ms. Null when the mark carries no timestamp (a
   * snapshot/chain mark) — in that case the surface relies on `mark_is_day_close` and
   * the response's own as-of time to decide whether to gray-out / age-badge the figure.
   * OPTIONAL so existing literal constructors stay compile-valid; enrichPosition always sets it.
   */
  mark_age_ms?: number | null;
  /**
   * True when the P&L is derived from the prior session's close (real but DAY-OLD).
   * The UI MUST label these 'prior close' and not present them as a live intraday P&L.
   * OPTIONAL for the same compat reason; enrichPosition always sets it.
   */
  mark_is_day_close?: boolean;
};

/** Calendar days to expiry, measured against the ET session date. Clamped at >= 0. */
export function daysToExpiry(expiry: string, now: Date = new Date()): number {
  const today = todayEt(now); // YYYY-MM-DD in ET
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const expMs = Date.parse(`${expiry.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(todayMs) || !Number.isFinite(expMs)) return 0;
  return Math.max(0, Math.round((expMs - todayMs) / 86_400_000));
}

/**
 * Attach valuation + derived fields to a stored position.
 * - valuation present  → 'live' with P&L/risk fields.
 * - valuation null + pending=true → 'pending' (e.g. just created; live values land on next GET).
 * - valuation null + pending=false → 'unavailable'.
 * DTE / breakeven (no live price needed) are always computed.
 */
export function enrichPosition(
  position: UserPositionRow,
  valuation: ContractValuation | null,
  now: Date = new Date(),
  pending = false,
  /**
   * Hint for WHY the valuation is unavailable, supplied by the caller (enrichment.ts) from
   * what it learned while resolving (e.g. contract not found in snapshot OR chain → likely
   * unlisted; found but no usable price → no-quote). Only meaningful when valuation is null and
   * pending is false; ignored otherwise. Defaults to 'unknown' for back-compat callers.
   */
  unavailableReason: ValuationUnavailableReason = "unknown"
): EnrichedPosition {
  const dte = daysToExpiry(position.expiry, now);

  // Breakeven only well-defined for long single-leg calls/puts.
  let breakeven: number | null = null;
  if (position.side === "long") {
    breakeven =
      position.option_type === "call"
        ? position.strike + position.entry_premium
        : position.strike - position.entry_premium;
  }

  const sideSign = position.side === "long" ? 1 : -1;
  const multiplier = position.contracts * 100;

  let current_value: number | null = null;
  let unrealized_pnl: number | null = null;
  let pnl_pct: number | null = null;
  let pct_to_breakeven: number | null = null;
  let distance_to_strike_pct: number | null = null;

  if (valuation) {
    // Side-aware so the accounting identity holds: for a LONG this is the asset value of
    // the contracts (positive); for a SHORT it's the cost-to-close LIABILITY (negative).
    // Without sideSign a short shows a positive "value" for what is actually money owed.
    current_value = Number((valuation.mark * multiplier * sideSign).toFixed(2));
    unrealized_pnl = Number(
      ((valuation.mark - position.entry_premium) * multiplier * sideSign).toFixed(2)
    );
    const cost = position.entry_premium * multiplier;
    if (cost > 0) {
      pnl_pct = Number(((unrealized_pnl / cost) * 100).toFixed(2));
    }
    const px = valuation.underlyingPrice;
    if (px != null && px > 0) {
      if (breakeven != null && breakeven > 0) {
        pct_to_breakeven = Number((((breakeven - px) / px) * 100).toFixed(2));
      }
      distance_to_strike_pct = Number((((position.strike - px) / px) * 100).toFixed(2));
    }
  }

  // Realized P&L — only for a CLOSED position with a recorded exit_premium. This is the
  // settled result and is INDEPENDENT of any live valuation (a closed leg runs a null
  // valuation). Same sideSign convention as unrealized P&L (long +1 / short −1), and the
  // same entry-cost denominator for the percent (guarding entry_premium=0).
  let realized_pnl: number | null = null;
  let realized_pnl_pct: number | null = null;
  if (position.status === "closed" && position.exit_premium != null) {
    realized_pnl = Number(
      ((position.exit_premium - position.entry_premium) * multiplier * sideSign).toFixed(2)
    );
    const cost = Math.abs(position.entry_premium * multiplier);
    if (cost > 0) {
      realized_pnl_pct = Number(((realized_pnl / cost) * 100).toFixed(2));
    }
  }

  // Freshness of the figure (truth mandate): mark_age_ms is known only when the mark
  // carries a timestamp (a live WS quote). A snapshot/chain mark has none here, so it
  // stays null and the surface ages it off the response's own as-of time. A day-close
  // mark is REAL but DAY-OLD — flag it so the UI labels it 'prior close', never as live.
  const mark_age_ms =
    valuation && valuation.refreshedAt != null
      ? Math.max(0, now.getTime() - valuation.refreshedAt)
      : null;
  const mark_is_day_close = valuation?.mark_is_day_close ?? false;

  const valuation_status: ValuationStatus = valuation ? "live" : pending ? "pending" : "unavailable";
  // Reason is only carried off-live: 'pending' for a just-created leg, the caller's hint for an
  // 'unavailable' one, and null when the valuation IS live (nothing to explain).
  const valuation_unavailable_reason: ValuationUnavailableReason | null =
    valuation_status === "live"
      ? null
      : valuation_status === "pending"
        ? "pending"
        : unavailableReason;

  return {
    ...position,
    valuation_status,
    valuation_unavailable_reason,
    valuation,
    current_value,
    unrealized_pnl,
    pnl_pct,
    realized_pnl,
    realized_pnl_pct,
    dte,
    breakeven,
    pct_to_breakeven,
    distance_to_strike_pct,
    mark_age_ms,
    mark_is_day_close,
  };
}
