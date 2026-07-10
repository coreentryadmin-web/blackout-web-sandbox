/**
 * Option execution simulator (P1 stub) — spread/slippage model for prospective evidence.
 * Full quote reconciliation ships later; this gives cost-adjusted expectancy scaffolding.
 */

export type OptionSimInput = {
  /** Underlying entry reference (SPX spot). */
  entry_spot: number;
  /** Mid quote for the 0DTE contract at decision time. */
  option_mid: number;
  /** Bid-ask spread width in premium points. */
  spread_width: number;
  direction: "long" | "short";
};

export type OptionSimResult = {
  assumed_fill: number;
  slippage_pts: number;
  half_spread_pts: number;
  /** Premium paid (long) or received (short) after adverse fill assumption. */
  effective_premium: number;
};

const DEFAULT_SLIPPAGE_BPS = 15;

function num(env: string | undefined, fallback: number): number {
  const n = Number(env?.trim());
  return Number.isFinite(n) ? n : fallback;
}

export function playbookOptionSlippageBps(): number {
  return num(process.env.PLAYBOOK_OPTION_SLIPPAGE_BPS, DEFAULT_SLIPPAGE_BPS);
}

/** Adverse-side fill: long pays ask-ish, short sells bid-ish. */
export function simulateOptionEntry(input: OptionSimInput): OptionSimResult {
  const halfSpread = Math.max(0, input.spread_width) / 2;
  const slip = (input.option_mid * playbookOptionSlippageBps()) / 10_000;
  const slippagePts = halfSpread + slip;
  const assumedFill =
    input.direction === "long"
      ? input.option_mid + slippagePts
      : Math.max(0.01, input.option_mid - slippagePts);

  return {
    assumed_fill: assumedFill,
    slippage_pts: slippagePts,
    half_spread_pts: halfSpread,
    effective_premium: assumedFill,
  };
}
