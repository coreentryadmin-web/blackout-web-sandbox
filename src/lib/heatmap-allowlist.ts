// Heat Maps warm-batch ticker lists.
//
// These lists drive the cron warm batch (pre-warm cache for the most popular
// names so the first viewer gets an instant hit). They do NOT gate anything —
// every optionable ticker gets the same 5s GEX/walls/beads data contract.

/**
 * The ~11 heatmap preset chips surfaced in the UI (src/features/thermal/components/GexHeatmap.tsx
 * `PRESET_TICKERS`). These are pre-warmed by the cron batch for instant cache hits.
 */
export const HEATMAP_PRESET_TICKERS = [
  "SPY",
  "SPX",
  "QQQ",
  "IWM",
  "NVDA",
  "TSLA",
  "AAPL",
  "AMD",
  "META",
  "AMZN",
  "GOOGL",
] as const;

/**
 * Additional known-liquid names pre-warmed by the cron batch beyond the preset chips.
 */
const HEATMAP_EXTRA_LIQUID_TICKERS = [
  "MSFT",
  "GOOG",
  "NFLX",
  "NDX",
  "DIA",
  "GLD",
  "TLT",
  "COIN",
  "MSTR",
  "SMH",
  "ASTS",
] as const;

/** Combined warm set — used by the cron batch to pre-warm cache. */
const WARM_SET = new Set<string>([
  ...HEATMAP_PRESET_TICKERS,
  ...HEATMAP_EXTRA_LIQUID_TICKERS,
]);

/** The preset tickers as a plain array (warm-cron batch source). */
export function heatmapPresetTickers(): string[] {
  return [...HEATMAP_PRESET_TICKERS];
}

/** Full warm-batch universe — Vector universe + dark-pool warm batch (~23 names). */
export function vectorUniverseTickers(): string[] {
  return [...WARM_SET];
}

/** Tickers warmed by heatmap-warm + vector-universe snapshot (presets + extra liquid). */
export function vectorWarmTickers(): string[] {
  return vectorUniverseTickers();
}
