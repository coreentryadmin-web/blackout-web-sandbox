/**
 * GEX Matrix Delta Calculation
 *
 * Compares previous vs. current heatmap matrices and extracts only changed strikes.
 * Used by the hybrid cron+SSE model to broadcast incremental updates without sending
 * full 168×14 matrices on every refresh.
 */

export type GexMatrix = {
  underlying: string;
  spot: number;
  strikes: number[];
  expiries: string[];
  gex: number[][];
  vex: number[][];
  asof: string;
};

export type StrikeUpdate = {
  strike: number;
  gex_call?: number;
  gex_put?: number;
  vex_call?: number;
  vex_put?: number;
};

export type MatrixDelta = {
  ticker: string;
  asof: string;
  spot: number;
  regime_text?: string;
  updated_strikes: StrikeUpdate[];
  timestamp_ms: number;
};

const CHANGE_THRESHOLD = 100; // Ignore changes < $100 notional (noise floor)

/**
 * Compare two matrices and extract strike-level deltas.
 * Returns null if matrices are structurally incompatible.
 */
export function calculateMatrixDelta(
  previous: GexMatrix | null,
  current: GexMatrix,
  regime?: string
): MatrixDelta | null {
  if (!previous) {
    return null;
  }

  // Structural compatibility check
  if (
    previous.underlying !== current.underlying ||
    previous.strikes.length !== current.strikes.length ||
    previous.expiries.length !== current.expiries.length ||
    previous.gex.length !== current.gex.length
  ) {
    return null;
  }

  const updated_strikes: StrikeUpdate[] = [];

  // Row-by-row comparison (each row = one strike across all expiries)
  for (let i = 0; i < current.strikes.length; i++) {
    const strike = current.strikes[i];
    const prevRow = previous.gex[i] ?? [];
    const currRow = current.gex[i] ?? [];

    // Aggregate GEX across expiries to detect changes
    const prevGexSum = prevRow.reduce((a, b) => a + (b ?? 0), 0);
    const currGexSum = currRow.reduce((a, b) => a + (b ?? 0), 0);
    const gexChange = Math.abs(currGexSum - prevGexSum);

    // Only include if significant change
    if (gexChange >= CHANGE_THRESHOLD) {
      updated_strikes.push({
        strike,
        gex_call: currGexSum >= 0 ? currGexSum : undefined,
        gex_put: currGexSum < 0 ? Math.abs(currGexSum) : undefined,
      });
    }
  }

  // If spot moved but strikes unchanged, still send update (for regime/regime_text changes)
  if (updated_strikes.length === 0 && Math.abs(current.spot - previous.spot) >= 1) {
    return {
      ticker: current.underlying,
      asof: current.asof,
      spot: current.spot,
      regime_text: regime,
      updated_strikes: [],
      timestamp_ms: Date.now(),
    };
  }

  if (updated_strikes.length === 0) {
    return null;
  }

  return {
    ticker: current.underlying,
    asof: current.asof,
    spot: current.spot,
    regime_text: regime,
    updated_strikes,
    timestamp_ms: Date.now(),
  };
}

/**
 * For testing: force-include all strikes (ignore threshold).
 * Used during verification to ensure matrix changes are captured.
 */
export function calculateMatrixDeltaFull(
  previous: GexMatrix | null,
  current: GexMatrix,
  regime?: string
): MatrixDelta {
  if (!previous) {
    return {
      ticker: current.underlying,
      asof: current.asof,
      spot: current.spot,
      regime_text: regime,
      updated_strikes: current.strikes.map((strike, i) => ({
        strike,
        gex_call: (current.gex[i] ?? []).reduce((a, b) => a + (b ?? 0), 0),
      })),
      timestamp_ms: Date.now(),
    };
  }

  const updated_strikes: StrikeUpdate[] = [];
  for (let i = 0; i < current.strikes.length; i++) {
    const strike = current.strikes[i];
    const currRow = current.gex[i] ?? [];
    const currGexSum = currRow.reduce((a, b) => a + (b ?? 0), 0);

    updated_strikes.push({
      strike,
      gex_call: currGexSum >= 0 ? currGexSum : undefined,
      gex_put: currGexSum < 0 ? Math.abs(currGexSum) : undefined,
    });
  }

  return {
    ticker: current.underlying,
    asof: current.asof,
    spot: current.spot,
    regime_text: regime,
    updated_strikes,
    timestamp_ms: Date.now(),
  };
}
