import type { PlaybookOptionExecutionSim } from "@/features/spx/lib/playbook-option-sim";
import type { SpxPlayDirection } from "@/features/spx/lib/spx-signals";

/** Greeks snapshot at entry for path-dependent premium estimates. */
export type OptionGreeksSnapshot = {
  delta: number | null;
  gamma: number | null;
  iv: number | null;
  theta_per_hour: number | null;
  entry_premium: number;
  entry_spot: number;
};

export type OptionPnlEstimate = {
  spot_move_pts: number;
  delta_pnl: number;
  gamma_pnl: number;
  theta_pnl: number;
  spread_cost: number;
  net_premium_pnl: number;
  model: "delta_gamma_theta_lite";
};

const DEFAULT_THETA_PCT_PER_HOUR = 0.12;

function num(v: number | null | undefined, fallback: number): number {
  return v != null && Number.isFinite(v) ? v : fallback;
}

/** Build greeks snapshot from option ticket at entry. */
export function buildGreeksSnapshot(input: {
  direction: SpxPlayDirection;
  entry_spot: number;
  option_mid: number;
  delta?: number | null;
  gamma?: number | null;
  iv?: number | null;
  execution_sim?: PlaybookOptionExecutionSim | null;
}): OptionGreeksSnapshot {
  const signedDelta =
    input.delta != null
      ? input.direction === "long"
        ? Math.abs(input.delta)
        : -Math.abs(input.delta)
      : input.direction === "long"
        ? 0.35
        : -0.35;

  return {
    delta: signedDelta,
    gamma: input.gamma ?? 0.02,
    iv: input.iv ?? null,
    theta_per_hour: -(input.option_mid * DEFAULT_THETA_PCT_PER_HOUR),
    entry_premium: input.execution_sim?.assumed_fill ?? input.option_mid,
    entry_spot: input.entry_spot,
  };
}

/**
 * Lightweight 0DTE premium P/L — delta·ΔS + ½·gamma·ΔS² + theta·Δt − costs.
 * Not a full vol surface; sufficient for evidence tiering vs spot-only metrics.
 */
export function estimateOptionPnl(input: {
  greeks: OptionGreeksSnapshot;
  current_spot: number;
  minutes_held: number;
  round_trip_cost_pts?: number | null;
}): OptionPnlEstimate {
  const ds = input.current_spot - input.greeks.entry_spot;
  const delta = num(input.greeks.delta, 0.35);
  const gamma = num(input.greeks.gamma, 0.02);
  const thetaPerHour = num(input.greeks.theta_per_hour, -input.greeks.entry_premium * DEFAULT_THETA_PCT_PER_HOUR);
  const hours = Math.max(0, input.minutes_held) / 60;

  const deltaPnl = delta * ds;
  const gammaPnl = 0.5 * gamma * ds * ds;
  const thetaPnl = thetaPerHour * hours;
  const spreadCost = input.round_trip_cost_pts ?? 0;

  return {
    spot_move_pts: ds,
    delta_pnl: deltaPnl,
    gamma_pnl: gammaPnl,
    theta_pnl: thetaPnl,
    spread_cost: spreadCost,
    net_premium_pnl: deltaPnl + gammaPnl + thetaPnl - spreadCost,
    model: "delta_gamma_theta_lite",
  };
}
