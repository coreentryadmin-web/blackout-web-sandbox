import type { VectorWalls } from "@/lib/api";
import type { VectorRegimePosture } from "./vector-regime";

/**
 * Gamma magnet — the dealer-hedging center of mass the price is drawn toward (or
 * pivots on). Pure + client-derivable from the walls the chart already has, so it
 * adds no server plumbing.
 *
 * Physics, stated honestly per regime (this is why `posture` matters):
 *  - LONG gamma  → dealers hedge AGAINST moves (buy dips / sell rips), so price is
 *    genuinely PINNED toward the gamma center of mass — a magnet.
 *  - SHORT gamma → dealers hedge WITH moves (sell dips / buy rips), so the same
 *    center of mass is not a magnet at all: it's a PIVOT that, once broken,
 *    ACCELERATES away. Calling it a "magnet" there would be a lie about the flow.
 *  - transition/unknown → report the level as a neutral center of mass, no claim.
 *
 * The magnet strike is the wall-strength (`pct`)-weighted mean of the call+put
 * walls — the concentration of dealer gamma. Not a made-up number: it's the
 * center of mass of the SAME strength values the beads render.
 */

export type GammaMagnetPull = "up" | "down" | "at";

export type GammaMagnet = {
  /** Strength-weighted center of mass of the gamma walls (rounded to cents). */
  strike: number;
  /** Signed (strike - spot)/spot. */
  distancePct: number;
  /** Which way the magnet sits relative to spot ("at" when within the dead-band). */
  pull: GammaMagnetPull;
  posture: VectorRegimePosture;
  /** Desk-terminal one-liner, phrased by regime (pin vs pivot). */
  callout: string;
};

/** Within ~0.15% of the magnet counts as sitting on it (no meaningful pull direction). */
const AT_BAND_PCT = 0.0015;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function deriveGammaMagnet(input: {
  spot: number | null | undefined;
  walls: VectorWalls | null | undefined;
  posture?: VectorRegimePosture;
}): GammaMagnet | null {
  const spot = input.spot;
  if (!(typeof spot === "number" && spot > 0)) return null;

  const levels = [
    ...(input.walls?.callWalls ?? []),
    ...(input.walls?.putWalls ?? []),
  ].filter(
    (w) =>
      w != null &&
      Number.isFinite(w.strike) &&
      w.strike > 0 &&
      Number.isFinite(w.pct) &&
      w.pct > 0
  );
  if (levels.length === 0) return null;

  let weight = 0;
  let weightedStrike = 0;
  for (const w of levels) {
    weight += w.pct;
    weightedStrike += w.strike * w.pct;
  }
  if (!(weight > 0)) return null;

  const strike = weightedStrike / weight;
  const distancePct = (strike - spot) / spot;
  const pull: GammaMagnetPull =
    Math.abs(distancePct) <= AT_BAND_PCT ? "at" : distancePct > 0 ? "up" : "down";
  const posture = input.posture ?? "unknown";

  return {
    strike: round2(strike),
    distancePct,
    pull,
    posture,
    callout: buildCallout(Math.round(strike), distancePct, pull, posture),
  };
}

function buildCallout(
  level: number,
  distancePct: number,
  pull: GammaMagnetPull,
  posture: VectorRegimePosture
): string {
  const dist = `${distancePct >= 0 ? "+" : ""}${(distancePct * 100).toFixed(2)}%`;
  if (posture === "long") {
    return pull === "at"
      ? `gamma magnet ${level} — spot pinned at the dealer-hedging center of mass`
      : `gamma magnet ${level} (${dist}) — long-gamma hedging pulls spot ${pull}`;
  }
  if (posture === "short") {
    return pull === "at"
      ? `gamma pivot ${level} — short gamma: a break here accelerates, it won't hold`
      : `gamma pivot ${level} (${dist}) — short gamma amplifies a move away, won't hold`;
  }
  return `gamma center of mass ${level} (${dist})`;
}
