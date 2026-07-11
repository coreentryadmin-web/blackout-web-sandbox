/**
 * Gamma regime — the single highest-leverage interpretation layer on Vector. It
 * reframes every wall: in a LONG-gamma regime (spot above the gamma flip) dealers
 * hedge AGAINST moves (sell rallies / buy dips) so price is pinned and mean-
 * reverting — walls act as magnets and extremes fade; in a SHORT-gamma regime
 * (spot below the flip) dealers hedge WITH moves (sell weakness / buy strength)
 * so volatility feeds on itself — walls break and trends run.
 *
 * Derived purely on the client from data already streamed (spot, gamma flip,
 * top walls) — no payload growth, no server round-trip, matches the server's
 * long/short posture semantics (see GexRegime in polygon-options-gex.ts).
 * `todayYmd`-free and Date-free → deterministic + unit-testable.
 */

export type VectorRegimePosture = "long" | "short" | "transition" | "unknown";

export type VectorRegime = {
  posture: VectorRegimePosture;
  /** Short chip label, e.g. "LONG GAMMA". */
  headline: string;
  /** One-line plain-English read incl. flip + nearest resistance/support. */
  read: string;
  /** Visual tone for the banner. */
  tone: "calm" | "volatile" | "neutral";
};

/**
 * Band (as a fraction of spot) around the flip within which we call the regime a
 * TRANSITION rather than committing to long/short — spot sitting right on the
 * flip is the highest-volatility, least-decided state, and flip-flopping the
 * banner tick-by-tick across an exact crossing would be noise. 0.1% of spot.
 */
const TRANSITION_BAND = 0.001;

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function deriveVectorRegime(input: {
  spot: number | null | undefined;
  gammaFlip: number | null | undefined;
  topCallWall?: number | null;
  topPutWall?: number | null;
}): VectorRegime {
  const { spot, gammaFlip } = input;
  if (
    spot == null ||
    gammaFlip == null ||
    !Number.isFinite(spot) ||
    !Number.isFinite(gammaFlip) ||
    spot <= 0 ||
    gammaFlip <= 0
  ) {
    return {
      posture: "unknown",
      headline: "REGIME —",
      read: "Gamma regime unavailable — waiting on positioning data.",
      tone: "neutral",
    };
  }

  const res = input.topCallWall != null ? `resistance ${fmt(input.topCallWall)}` : null;
  const sup = input.topPutWall != null ? `support ${fmt(input.topPutWall)}` : null;
  const levels = [res, sup].filter(Boolean).join(", ");
  const levelsClause = levels ? ` ${levels}.` : "";

  const dist = Math.abs(spot - gammaFlip) / spot;
  if (dist <= TRANSITION_BAND) {
    return {
      posture: "transition",
      headline: "AT GAMMA FLIP",
      read: `Spot ${fmt(spot)} is sitting on the gamma flip (${fmt(gammaFlip)}) — regime is undecided; expect the sharpest moves as dealers flip hedging direction.${levelsClause}`,
      tone: "volatile",
    };
  }

  if (spot > gammaFlip) {
    return {
      posture: "long",
      headline: "LONG GAMMA",
      read: `Spot ${fmt(spot)} is above the gamma flip (${fmt(gammaFlip)}) → long gamma: dealers sell rallies and buy dips, so price is range-bound — fade extremes.${levelsClause}`,
      tone: "calm",
    };
  }

  return {
    posture: "short",
    headline: "SHORT GAMMA",
    read: `Spot ${fmt(spot)} is below the gamma flip (${fmt(gammaFlip)}) → short gamma: dealers sell weakness and buy strength, so moves accelerate — trade momentum, respect breaks.${levelsClause}`,
    tone: "volatile",
  };
}
