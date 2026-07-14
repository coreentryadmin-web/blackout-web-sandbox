/**
 * Derive the REAL inputs the expected-move engine needs — an ATM implied vol and a time-to-expiry —
 * from the options chain, scoped to a DTE horizon. Pure (the chain fetch lives in the server shell),
 * so the ATM-selection + horizon logic is unit-tested without a network.
 *
 * Expected move is a PER-EXPIRY quote, but the horizon toggle can span several expiries. We quote the
 * horizon's NEAREST (front) expiry — the dominant, most-liquid one a desk reads first — using the
 * same `expiriesForHorizon` scoping the GEX walls / max-pain use (so a 0DTE horizon over a weekend
 * honestly snaps to the next live expiry instead of returning nothing).
 *
 * ATM IV = the implied vol at the strike nearest spot for that expiry, averaged across the call and
 * put legs when both are present (the two ATM legs quote near-identical IV; averaging smooths a
 * one-sided quote gap). Only real, positive IVs count — a strike with no usable IV is skipped, and if
 * nothing usable remains the function returns null rather than inventing a vol.
 */

import { expiriesForHorizon, type VectorDteHorizon } from "./vector-dte-horizon";
import { yearsToExpiry, type ReconstructContract } from "./vector-gex-reconstruct";
import type { ExpectedMoveInput } from "./vector-expected-move";

const DAYS_PER_YEAR = 365;

export type ExpectedMoveDerived = ExpectedMoveInput & {
  /** The front expiry the quote is scoped to (YYYY-MM-DD). */
  expiry: string;
};

/**
 * Pick the ATM IV + time-to-expiry for the horizon's front expiry from a chain snapshot.
 * Returns null when there's no scoped expiry or no usable ATM IV — never a fabricated vol.
 *
 * @param contracts banded chain snapshot (all horizons) — needs strike/expiry/iv/type.
 * @param spot       live underlying, used to find the ATM strike.
 * @param horizon    the member's DTE selection.
 * @param todayYmd   session date (YYYY-MM-DD) for horizon scoping + time-to-expiry.
 */
export function deriveExpectedMoveInputs(
  contracts: readonly ReconstructContract[],
  spot: number,
  horizon: VectorDteHorizon,
  todayYmd: string
): ExpectedMoveDerived | null {
  if (!(spot > 0) || contracts.length === 0) return null;

  const allExpiries = [...new Set(contracts.map((c) => c.expiry))].sort();
  const scoped = expiriesForHorizon(allExpiries, horizon, todayYmd);
  if (scoped.length === 0) return null;

  // Front (nearest) expiry of the scoped set — expiries sort lexicographically = chronologically.
  const frontExpiry = [...scoped].sort()[0]!;
  const atExpiry = contracts.filter((c) => c.expiry === frontExpiry && c.iv > 0);
  if (atExpiry.length === 0) return null;

  // The ATM strike: the strike with a usable IV nearest to spot.
  let atmStrike = atExpiry[0]!.strike;
  let bestDist = Math.abs(atmStrike - spot);
  for (const c of atExpiry) {
    const d = Math.abs(c.strike - spot);
    if (d < bestDist) {
      bestDist = d;
      atmStrike = c.strike;
    }
  }

  // Average the call + put IV at that ATM strike (whichever legs are present with real IV).
  const atmLegs = atExpiry.filter((c) => c.strike === atmStrike);
  const ivs = atmLegs.map((c) => c.iv).filter((v) => v > 0);
  if (ivs.length === 0) return null;
  const atmIv = ivs.reduce((s, v) => s + v, 0) / ivs.length;

  // Time to expiry in days: reuse the tested ACT/365 helper (floored at ~1 min, so a same-day 0DTE
  // yields a real narrow horizon rather than 0). Convert years → days for the engine's API.
  const dteDays = yearsToExpiry(frontExpiry, todayYmd) * DAYS_PER_YEAR;

  return { spot, atmIv, dteDays, expiry: frontExpiry };
}
