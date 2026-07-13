import "server-only";

// Server-side Vector chart technicals — closes the biggest BIE gap.
//
// The Vector chart computes VWAP / EMA(9/21/50) / RSI / MACD / golden-pocket / market-structure
// CLIENT-side from the drawn candles (vector-technicals.ts::summarizeTechnicals), so before this
// module BIE was blind to them — fetchVectorFullState set technicals: null. This computes the SAME
// read server-side by fetching the session's 1m seed bars (the same fetchVectorSeedBars the chart
// SSR uses) and running the pure aggregate→summarize→map pipeline in
// vector-server-technicals-core.ts. This file is the thin server-only fetch wrapper; the pure core
// is a separate side-effect-free module so it stays unit-testable under `tsx --test` (the same
// split vector-dte-walls-server.ts / vector-dte-walls-core.ts use).

import { fetchVectorSeedBars } from "./vector-seed-bars";
import { normalizeVectorTicker } from "./vector-ticker";
import { computeTechnicalsFromBars, playTechnicalsFromSummary } from "./vector-server-technicals-core";
import type { PlayTechnicals } from "./vector-play-engine";

/**
 * Server-side chart technicals for a Vector ticker at a timeframe. Fetches the session's 1m seed
 * bars (walking back to the latest session with data), then runs the pure pipeline. `spot` is the
 * live price (VWAP-delta / golden-pocket-floor reference), falling back to the last close when null.
 * Best-effort: returns null on any gap (no bars, thrown fetch) — a live read must degrade to
 * "no technicals", never throw or fabricate.
 */
export async function computeServerTechnicals(
  ticker: string,
  timeframeMin = 5,
  spot: number | null = null
): Promise<PlayTechnicals | null> {
  try {
    const t = normalizeVectorTicker(ticker);
    const { bars } = await fetchVectorSeedBars(t);
    return computeTechnicalsFromBars(bars, timeframeMin, spot);
  } catch {
    return null;
  }
}

// Re-export the pure core so callers that already import from here keep working; tests import the
// pure functions from the core module directly (side-effect-free) to avoid the server-only guard.
export { computeTechnicalsFromBars, playTechnicalsFromSummary };
