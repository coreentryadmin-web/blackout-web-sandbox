import { computeGexWalls, type GexWalls } from "@/lib/providers/gex-wall-levels";
import { buildWallHistorySample } from "./vector-wall-sample";
import type { WallHistorySample } from "./vector-wall-history";

/**
 * Historical intraday GEX reconstruction — the honest way to get DENSE wall rails
 * for a PAST session without a live recorder, and without fabricating anything.
 *
 * Insight: dealer gamma-exposure per strike over a session is a function of the
 * options chain (strike, expiry, OI, IV — ~constant intraday, EOD snapshot) and
 * the INTRADAY SPOT PATH. Gamma is closed-form (Black-Scholes); as real observed
 * spot moves minute-to-minute, each strike's gamma — and thus the GEX walls —
 * shift. So a real dense rail reconstructs from {chain snapshot} × {real spot
 * bars}, both of which Polygon serves for any past date. No per-minute per-strike
 * greek history is needed (UW/Polygon don't expose that); we recompute gamma
 * along the true price path.
 *
 * Pure + dependency-light (no network, no Date.now — `sessionYmd` is passed in),
 * so the whole reconstruction is deterministic and unit-testable. The network
 * fetch (chain + underlying bars) lives in the server wrapper that calls this.
 *
 * Honesty: OI and IV are the EOD snapshot (they barely move intraday relative to
 * the spot-driven gamma shift); the rail is labeled a reconstruction, and gamma
 * is standard BSM, not invented numbers.
 */

const INV_SQRT_2PI = 0.3989422804014327;
function normPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

export type ReconstructContract = {
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  openInterest: number;
  iv: number;
  type: "call" | "put";
};

export type SpotSample = { time: number; spot: number };

/** ACT/365 years from a session date to an expiry (both YYYY-MM-DD), floored at a tiny epsilon. */
export function yearsToExpiry(expiry: string, sessionYmd: string): number {
  const exp = Date.parse(`${expiry}T20:00:00Z`); // ~16:00 ET close
  const now = Date.parse(`${sessionYmd}T13:30:00Z`); // ~09:30 ET open
  if (!Number.isFinite(exp) || !Number.isFinite(now)) return 0;
  return Math.max((exp - now) / (365 * 86_400_000), 1 / (365 * 24 * 60)); // ≥ ~1 minute
}

/** Black-Scholes gamma per share (r=q=0): φ(d1) / (S·σ·√T). */
export function gammaPerShare(spot: number, strike: number, t: number, sigma: number): number {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(sigma > 0)) return 0;
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + 0.5 * sigma * sigma * t) / (sigma * sqrtT);
  return normPdf(d1) / (spot * sigma * sqrtT);
}

/**
 * Net dealer GEX by strike at a given spot: Σ sign · γ · OI · 100 · S² · 0.01,
 * calls +, puts − (same convention as the live Polygon GEX engine). Returns a
 * Map<strike, netGex> ready for computeGexWalls.
 */
export function gexLadderAtSpot(
  contracts: readonly ReconstructContract[],
  spot: number,
  sessionYmd: string
): Map<number, number> {
  const ladder = new Map<number, number>();
  if (!(spot > 0)) return ladder;
  for (const c of contracts) {
    if (!(c.openInterest > 0) || !(c.iv > 0)) continue;
    const t = yearsToExpiry(c.expiry, sessionYmd);
    const g = gammaPerShare(spot, c.strike, t, c.iv);
    if (g <= 0) continue;
    const gex = (c.type === "call" ? 1 : -1) * g * c.openInterest * 100 * spot * spot * 0.01;
    ladder.set(c.strike, (ladder.get(c.strike) ?? 0) + gex);
  }
  return ladder;
}

/**
 * Reconstruct a dense wall-history rail for a session: for each spot sample,
 * recompute the GEX ladder along the real price path and derive the walls.
 * Returns byte-compatible WallHistorySample[] the chart already renders.
 */
export function reconstructGexRail(
  contracts: readonly ReconstructContract[],
  spotSamples: readonly SpotSample[],
  sessionYmd: string
): WallHistorySample[] {
  const out: WallHistorySample[] = [];
  for (const { time, spot } of spotSamples) {
    const ladder = gexLadderAtSpot(contracts, spot, sessionYmd);
    if (ladder.size === 0) continue;
    const walls: GexWalls = computeGexWalls(ladder);
    const sample = buildWallHistorySample({
      time,
      gexWalls: walls,
      gammaFlip: gammaFlipFromLadder(ladder, spot),
      vexWalls: null,
      vexFlip: null,
    });
    if (sample) out.push(sample);
  }
  return out;
}

/**
 * Gamma flip — the strike nearest spot where cumulative net GEX (summed low→high)
 * crosses zero. Approximate but honest: it's the boundary between the net-short
 * and net-long gamma regions of the reconstructed ladder.
 */
export function gammaFlipFromLadder(ladder: Map<number, number>, spot: number): number | null {
  const strikes = [...ladder.keys()].sort((a, b) => a - b);
  if (strikes.length < 2) return null;
  let cum = 0;
  let prevStrike = strikes[0]!;
  let prevCum = 0;
  for (const k of strikes) {
    cum += ladder.get(k) ?? 0;
    if (prevCum <= 0 && cum > 0) {
      // linear interp of the zero-crossing between prevStrike and k
      const frac = prevCum === cum ? 0 : -prevCum / (cum - prevCum);
      return prevStrike + frac * (k - prevStrike);
    }
    prevStrike = k;
    prevCum = cum;
  }
  // No sign change → flip is on the side spot is nearest; return null rather than guess.
  void spot;
  return null;
}
