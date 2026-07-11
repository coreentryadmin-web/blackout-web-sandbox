/**
 * Option execution simulator (P1) — spread/slippage model for prospective evidence.
 */
import type { OptionTicket } from "@/features/spx/lib/spx-play-options";
import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";

export type OptionSimInput = {
  entry_spot: number;
  option_mid: number;
  spread_width: number;
  direction: "long" | "short";
};

export type OptionSimResult = {
  assumed_fill: number;
  slippage_pts: number;
  half_spread_pts: number;
  effective_premium: number;
};

/** Persisted on `option_ticket.execution_sim` at play open for cost-adjusted research. */
export type PlaybookOptionExecutionSim = OptionSimResult & {
  option_mid: number | null;
  spread_width: number | null;
  spread_pct: number | null;
  model: "adverse_half_spread_plus_bps";
  exit_assumed_fill?: number | null;
  exit_slippage_pts?: number | null;
  round_trip_cost_pts?: number | null;
};

const DEFAULT_SLIPPAGE_BPS = 15;

function num(env: string | undefined, fallback: number): number {
  const n = Number(env?.trim());
  return Number.isFinite(n) ? n : fallback;
}

export function playbookOptionSlippageBps(): number {
  return num(process.env.PLAYBOOK_OPTION_SLIPPAGE_BPS, DEFAULT_SLIPPAGE_BPS);
}

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

/** Exit fill model — same adverse half-spread + bps (conservative research default). */
export function simulateOptionExit(input: OptionSimInput): OptionSimResult {
  const halfSpread = Math.max(0, input.spread_width) / 2;
  const slip = (input.option_mid * playbookOptionSlippageBps()) / 10_000;
  const slippagePts = halfSpread + slip;
  const assumedFill =
    input.direction === "long"
      ? Math.max(0.01, input.option_mid - slippagePts)
      : input.option_mid + slippagePts;

  return {
    assumed_fill: assumedFill,
    slippage_pts: slippagePts,
    half_spread_pts: halfSpread,
    effective_premium: assumedFill,
  };
}

/** Build execution sim from a live option ticket at BUY commit time. */
export function buildOptionExecutionSim(
  ticket: OptionTicket,
  direction: SpxPlayDirection,
  entrySpot: number
): PlaybookOptionExecutionSim | null {
  if (ticket.blocked || ticket.mid == null || ticket.mid <= 0) return null;

  const spreadWidth =
    ticket.bid != null && ticket.ask != null && ticket.ask >= ticket.bid
      ? ticket.ask - ticket.bid
      : ticket.mid * ((ticket.spread_pct ?? 8) / 100);

  const sim = simulateOptionEntry({
    entry_spot: entrySpot,
    option_mid: ticket.mid,
    spread_width: spreadWidth,
    direction,
  });

  const exitSim = simulateOptionExit({
    entry_spot: entrySpot,
    option_mid: ticket.mid,
    spread_width: spreadWidth,
    direction,
  });

  return {
    ...sim,
    option_mid: ticket.mid,
    spread_width: spreadWidth,
    spread_pct: ticket.spread_pct,
    model: "adverse_half_spread_plus_bps",
    exit_assumed_fill: exitSim.assumed_fill,
    exit_slippage_pts: exitSim.slippage_pts,
    round_trip_cost_pts: sim.slippage_pts + exitSim.slippage_pts,
  };
}
