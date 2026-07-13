// Pure core for server-side Vector chart technicals — deliberately side-effect-free (NO
// `import "server-only"`) so it can be unit-tested with a plain `tsx --test` import, the same
// split vector-dte-walls-core.ts uses. vector-server-technicals.ts (the server-only fetch wrapper)
// re-exports these; the runtime surface is identical.
//
// Reuses the EXACT chart numerics: aggregateVectorBars (the TradingView-style bucketer the chart
// uses) + summarizeTechnicals (the always-on terminal summarizer), then maps the summary to the
// compact PlayTechnicals shape the play engine + BIE brief read — one derivation, so the server
// read can never disagree with the chart.

import type { VectorSeedBar } from "./vector-seed-bars";
import { aggregateVectorBars } from "./vector-bar-timeframes";
import { summarizeTechnicals, type TechnicalsSummary } from "./vector-technicals";
import type { PlayTechnicals } from "./vector-play-engine";

/**
 * Map the always-on TechnicalsSummary (client terminal shape) to the compact PlayTechnicals shape
 * the play engine + desk brief read. Pure — the two shapes differ only in the emaStack / macd
 * vocabulary (bullish/bearish → up/down, bull/bear) and the structure sub-shape; everything else
 * passes through, null-preserving (never fabricated).
 */
export function playTechnicalsFromSummary(s: TechnicalsSummary): PlayTechnicals {
  return {
    vwap: s.vwap,
    emaStack:
      s.emaStack === "bullish" ? "up" : s.emaStack === "bearish" ? "down" : s.emaStack === "mixed" ? "mixed" : null,
    rsi: s.rsi,
    macd: s.macdState === "bullish" ? "bull" : s.macdState === "bearish" ? "bear" : null,
    goldenPocket: s.goldenPocket,
    structure: s.structure
      ? { type: s.structure.type, direction: s.structure.direction, level: s.structure.level }
      : null,
  };
}

/**
 * Aggregate 1m bars to the timeframe, summarize, map. Returns null when there are no bars. `spot` is
 * the live price (VWAP-delta / golden-pocket-floor reference); summarizeTechnicals falls back to the
 * last close when null. VectorSeedBar is a structural superset of the summarizer's TechnicalsBar
 * (time/high/low/close/volume?), so the aggregated bars satisfy it directly.
 */
export function computeTechnicalsFromBars(
  minuteBars: readonly VectorSeedBar[],
  timeframeMin: number,
  spot: number | null
): PlayTechnicals | null {
  if (!minuteBars.length) return null;
  const agg = aggregateVectorBars([...minuteBars], timeframeMin);
  if (!agg.length) return null;
  const summary = summarizeTechnicals(agg, spot);
  return playTechnicalsFromSummary(summary);
}
