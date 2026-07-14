/**
 * Max-pain engine for Vector — the strike at which the aggregate intrinsic value of all open
 * options is MINIMISED, i.e. where option *writers* (net short) pay out the least and buyers feel
 * the most "pain" if price pins there at expiry. A classic options-positioning level that traders
 * watch as a magnet into expiration, alongside the gamma walls Vector already draws.
 *
 * Pure + dependency-free: it's a function of the option chain's open interest by strike (calls and
 * puts) and nothing else — no spot, no greeks, no network, no clock — so it's deterministic and
 * unit-tested directly. The chain it consumes is the SAME `{strike, type, openInterest}` shape the
 * GEX reconstruction already fetches per horizon, so max pain scopes to the member's DTE selection
 * for free (filter upstream, same as the walls).
 *
 * Definition (standard): for a candidate settlement price P (each listed strike is a candidate,
 * since the total is piecewise-linear with kinks only at strikes), the writers' payout is
 *   Σ callOI(Kc)·max(0, P − Kc)·100  +  Σ putOI(Kp)·max(0, Kp − P)·100
 * — every call struck below P and every put struck above P is ITM. Max pain is the P minimising
 * that sum. The ×100 contract multiplier makes the reported figures real dollars; it's a constant
 * so it doesn't move the arg-min.
 */

import { expiriesForHorizon, type VectorDteHorizon } from "./vector-dte-horizon";

/** The only chain fields max pain needs. `ReconstructContract` structurally satisfies this. */
export type MaxPainContract = { strike: number; type: "call" | "put"; openInterest: number };

/** Writers' dollar payout split at one candidate settlement strike. */
export type MaxPainPoint = { strike: number; callCash: number; putCash: number; totalCash: number };

export type MaxPainResult = {
  /** The strike minimising total intrinsic payout — the max-pain level. */
  maxPain: number;
  /** Every candidate strike with its call/put/total payout, ascending by strike (for viz/tooltip). */
  points: MaxPainPoint[];
};

const CONTRACT_MULTIPLIER = 100;

/**
 * Compute the max-pain strike (and the full payout curve) from an option chain's open interest.
 * Contracts with non-finite strike or non-positive OI are ignored. Returns null when nothing usable
 * remains, so the caller draws nothing rather than a bogus level. Ties on the minimum resolve to the
 * LOWER strike (deterministic).
 */
export function computeMaxPain(contracts: readonly MaxPainContract[]): MaxPainResult | null {
  const calls: Array<{ strike: number; oi: number }> = [];
  const puts: Array<{ strike: number; oi: number }> = [];
  const strikeSet = new Set<number>();
  for (const c of contracts) {
    if (!Number.isFinite(c.strike) || !(c.openInterest > 0)) continue;
    strikeSet.add(c.strike);
    (c.type === "call" ? calls : puts).push({ strike: c.strike, oi: c.openInterest });
  }
  if (strikeSet.size === 0) return null;

  const candidates = [...strikeSet].sort((a, b) => a - b);
  const points: MaxPainPoint[] = candidates.map((p) => {
    let callCash = 0;
    for (const c of calls) if (p > c.strike) callCash += c.oi * (p - c.strike);
    let putCash = 0;
    for (const q of puts) if (q.strike > p) putCash += q.oi * (q.strike - p);
    callCash *= CONTRACT_MULTIPLIER;
    putCash *= CONTRACT_MULTIPLIER;
    return { strike: p, callCash, putCash, totalCash: callCash + putCash };
  });

  // Min total; candidates are ascending so the first minimum is the lowest strike (tie-break).
  let best = points[0]!;
  for (const pt of points) if (pt.totalCash < best.totalCash) best = pt;
  return { maxPain: best.strike, points };
}

/**
 * Max pain scoped to a DTE horizon — the read behind the chart's DTE toggle. Filters the chain to
 * the horizon's expiries (same `expiriesForHorizon` the GEX walls use, so the honest "nearest
 * expiry" fallback applies — a 0DTE horizon over a weekend snaps to the next live expiry rather
 * than returning nothing) and computes max pain over just those contracts. Null when the horizon
 * has no expiry / no usable OI. Kept pure (the chain fetch lives in the server shell).
 */
export function maxPainForHorizon(
  contracts: readonly (MaxPainContract & { expiry: string })[],
  horizon: VectorDteHorizon,
  todayYmd: string
): MaxPainResult | null {
  if (contracts.length === 0) return null;
  const expiries = [...new Set(contracts.map((c) => c.expiry))].sort();
  const scoped = new Set(expiriesForHorizon(expiries, horizon, todayYmd));
  if (scoped.size === 0) return null;
  return computeMaxPain(contracts.filter((c) => scoped.has(c.expiry)));
}
