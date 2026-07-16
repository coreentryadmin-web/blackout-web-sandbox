// NOTE: intentionally NOT `import "server-only"`. This is a pure data + predicate module (preset
// ticker list + allowlist checks, no secrets / no server APIs), imported by polygon-options-gex which
// the valuation test suite pulls in under tsx/node — where `server-only` throws ("cannot be imported
// from a Client Component"). It's test- and client-safe like tool-access.ts; the UW-budget gating it
// supports is enforced in the server route, not by this leaf's import guard.

// ---------------------------------------------------------------------------
// Heat Maps server-side ticker lists.
//
// HISTORY: these lists originally gated UW overlay fetches (flow-per-strike +
// dark-pool) to a small allowlist (~23 names) to protect the UW 2-RPS cluster
// budget. As of 2026-07-16 ALL tickers get uniform treatment — 5s GEX/walls/beads,
// UW overlays, dark-pool, fast-move bypass, cross-validation. The per-request UW
// budget is protected by the overlay cache TTL (30s), the UW circuit breaker, and
// single-flight coalescing — not by restricting which tickers are allowed.
//
// The preset/warm lists are RETAINED for the cron warm batch (pre-warm cache for
// the most popular names so the first viewer gets an instant hit), but they no
// longer GATE anything — every optionable ticker gets the same data contract.
// ---------------------------------------------------------------------------

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

const TICKER_RE = /^[A-Z0-9.\-]{1,8}$/;

/**
 * Always true for any valid ticker — ALL tickers now get UW overlays, dark-pool,
 * and the full data contract. The per-request UW budget is protected by cache TTL,
 * circuit breaker, and single-flight coalescing.
 */
export function isHeatmapOverlayAllowed(ticker: string): boolean {
  const root = String(ticker ?? "").trim().toUpperCase();
  return root.length > 0 && TICKER_RE.test(root);
}

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

/**
 * Always true for any valid ticker — ALL tickers now get fast-move bypass,
 * cross-validation, and uniform 5s cache TTL.
 */
export function isHeatmapPreset(ticker: string): boolean {
  const root = String(ticker ?? "").trim().toUpperCase();
  return root.length > 0 && TICKER_RE.test(root);
}
