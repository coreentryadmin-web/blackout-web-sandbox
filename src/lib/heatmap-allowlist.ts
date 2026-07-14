// NOTE: intentionally NOT `import "server-only"`. This is a pure data + predicate module (preset
// ticker list + allowlist checks, no secrets / no server APIs), imported by polygon-options-gex which
// the valuation test suite pulls in under tsx/node — where `server-only` throws ("cannot be imported
// from a Client Component"). It's test- and client-safe like tool-access.ts; the UW-budget gating it
// supports is enforced in the server route, not by this leaf's import guard.

// ---------------------------------------------------------------------------
// Heat Maps server-side allowlist.
//
// THE POINT: the gex-heatmap route's UW overlays (flow-per-strike + dark-pool)
// are the only part of the heatmap that touches Unusual Whales — and UW is capped
// at 2 RPS CLUSTER-WIDE (shared by the desk / Largo / Night Hawk / HELIX). The
// matrix itself is a pure Polygon cache-reader and is fine for ANY ticker, but
// fetching UW overlays for ANY 8-char-regex symbol means 1000 users on 1000
// distinct tickers would each mint a fresh UW overlay fetch and starve the budget.
//
// So overlays are gated to a SMALL, KNOWN-LIQUID allowlist (the heatmap preset
// chips + a handful of liquid names). Off-allowlist tickers still get the full
// dealer-gamma matrix — they just serve the overlay-free contract (matrix only),
// exactly the same shape `gex-positioning` already returns for every consumer.
//
// The set is GLOBAL (never per-user) so the route stays a cache-reader: warming /
// caching keys on these constants, never on caller identity.
// ---------------------------------------------------------------------------

/**
 * The ~11 heatmap preset chips surfaced in the UI (src/features/thermal/components/GexHeatmap.tsx
 * `PRESET_TICKERS`). Kept in sync MANUALLY — these are the names the warm cron batches
 * and the only symbols whose UW overlays are pre-warmed. SPX index options resolve to
 * I:SPX upstream but the user-facing ticker key is "SPX".
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
 * Additional known-liquid names allowed to fetch UW overlays beyond the preset chips.
 * These are heavily-traded, deep-options-chain symbols where the overlay budget spend
 * is worth it. Kept deliberately short — every entry here is one more ticker competing
 * for the 2-RPS UW budget. Off-list symbols still get the full matrix, overlay-free.
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
  // Heavily-traded retail options names. Being on this list also puts them in the recorded Vector
  // universe (vectorUniverseTickers → the 5-min wall-history recorder cron), so their bead rail
  // accumulates from the session open instead of only forward-building from a member's first view —
  // the fix for "ASTS only shows single beads" (an unrecorded ticker has no intraday trail to seed,
  // so seedWallHistoryForDisplay honestly draws one dot per wall at the last bar).
  "ASTS",
] as const;

/** Normalized allowlist set (uppercased) — overlays fetch ONLY for these symbols. */
const ALLOWLIST = new Set<string>([
  ...HEATMAP_PRESET_TICKERS,
  ...HEATMAP_EXTRA_LIQUID_TICKERS,
]);

/**
 * True when `ticker` is on the heatmap overlay allowlist (preset chip or known-liquid
 * name). Off-allowlist symbols still get the full dealer-gamma matrix — they just skip
 * the UW overlay fetch and serve the matrix-only contract. Input is normalized
 * (trimmed/uppercased) to match the route's ticker key.
 */
export function isHeatmapOverlayAllowed(ticker: string): boolean {
  const root = String(ticker ?? "").trim().toUpperCase();
  return root.length > 0 && ALLOWLIST.has(root);
}

/** The preset tickers as a plain array (warm-cron batch source). */
export function heatmapPresetTickers(): string[] {
  return [...HEATMAP_PRESET_TICKERS];
}

/** Full overlay allowlist — Vector universe + dark-pool warm batch (~21 names). */
export function vectorUniverseTickers(): string[] {
  return [...ALLOWLIST];
}

/** Tickers warmed by heatmap-warm + vector-universe snapshot (presets + extra liquid). */
export function vectorWarmTickers(): string[] {
  return vectorUniverseTickers();
}

/** True when `ticker` is one of the ~11 warm presets (the fast-move + warm-cron set). */
export function isHeatmapPreset(ticker: string): boolean {
  const root = String(ticker ?? "").trim().toUpperCase();
  return root.length > 0 && (HEATMAP_PRESET_TICKERS as readonly string[]).includes(root);
}
