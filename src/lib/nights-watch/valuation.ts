// Night's Watch valuation — PURE functions over an already-fetched options chain.
// Upstream fetching + caching live in lib/nights-watch/chain-cache.ts; this file
// never touches the network, so it can never be the per-user upstream-call hot path.
//
// NEVER fabricates a price: when no usable price exists on the matched contract,
// valuationFromContract() returns null and enrichPosition() reports 'unavailable'.

import type { ChainContract } from "@/lib/providers/polygon-options-gex";
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
  const snapBid = finiteOrNull(contract.last_quote?.bid);
  const snapAsk = finiteOrNull(contract.last_quote?.ask);
  const lastTrade = finiteOrNull(contract.last_trade?.price);
  const dayClose = finiteOrNull(contract.day?.close);

  let mark: number | null = null;
  let mark_source: MarkSource = "none";
  let bid = snapBid;
  let ask = snapAsk;

  // 1) Live WS mark first — freshest real-time mid. Prefer its bid/ask too.
  if (liveMark && Number.isFinite(liveMark.mark) && liveMark.mark >= 0) {
    mark = liveMark.mark;
    mark_source = "ws";
    if (liveMark.bid != null) bid = liveMark.bid;
    if (liveMark.ask != null) ask = liveMark.ask;
  } else if (snapBid != null && snapAsk != null && snapAsk > 0 && snapBid >= 0) {
    // 2) snapshot mid — bid may be 0 for deep-OTM; ask>0 keeps it a real quote
    mark = (snapBid + snapAsk) / 2;
    mark_source = "snapshot";
  } else if (lastTrade != null && lastTrade > 0) {
    mark = lastTrade;
    mark_source = "snapshot";
  } else if (dayClose != null && dayClose > 0) {
    mark = dayClose;
    mark_source = "snapshot";
  }
  if (mark == null || !(mark >= 0)) return null;

  const up = finiteOrNull(contract.underlying_asset?.price) ?? (spot > 0 ? spot : null);

  return {
    mark: Number(mark.toFixed(4)),
    bid,
    ask,
    delta: finiteOrNull(contract.greeks?.delta),
    gamma: finiteOrNull(contract.greeks?.gamma),
    theta: finiteOrNull(contract.greeks?.theta),
    iv: finiteOrNull(contract.implied_volatility),
    openInterest: finiteOrNull(contract.open_interest),
    underlyingPrice: up != null && up > 0 ? up : null,
    mark_source,
  };
}

export type ValuationStatus = "live" | "unavailable" | "pending";

export type EnrichedPosition = UserPositionRow & {
  valuation_status: ValuationStatus;
  valuation: ContractValuation | null;
  current_value: number | null;
  unrealized_pnl: number | null;
  pnl_pct: number | null;
  dte: number;
  breakeven: number | null;
  pct_to_breakeven: number | null;
  distance_to_strike_pct: number | null;
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
  pending = false
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

  return {
    ...position,
    valuation_status: valuation ? "live" : pending ? "pending" : "unavailable",
    valuation,
    current_value,
    unrealized_pnl,
    pnl_pct,
    dte,
    breakeven,
    pct_to_breakeven,
    distance_to_strike_pct,
  };
}
