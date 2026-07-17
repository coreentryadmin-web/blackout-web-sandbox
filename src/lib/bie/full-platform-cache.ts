// bie:full-state cache — the 24/7 full-platform snapshot BIE reads (task #54).
//
// Side-effect-free (no `server-only`) so the key + round-trip are unit-testable; the type is
// structural so importing this never pulls the loader graph. The cron (api/cron/
// bie-full-state-snapshot) writes this every RTH tick; BIE reads it to answer "what's the whole
// platform doing right now" without re-running every loader per query.

import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

/** Broad, cross-product platform snapshot. All fields fail-open to null — a snapshot is best-effort. */
export type BieFullState = {
  asOf: string;
  /** getPlatformSnapshot() — SPX desk + flow tape + Night Hawk in one. */
  platform: unknown | null;
  /** fetchPlatformIntelSnapshot() — market-regime backdrop (RDS). */
  intel: unknown | null;
  /** refreshVectorUniverseSnapshot() rows — Vector wall summary across the universe. */
  vectorUniverse: unknown | null;
  /** fetchUwDarkPoolMarketWide() — market-wide dark pool. */
  darkPool: unknown | null;
  /** fetchHotTickers() — hottest flow names. */
  hotTickers: unknown | null;
  /** Thermal canonical positioning — same contract as Heat Maps / SPX rail. */
  thermalSpx: unknown | null;
  thermalSpy: unknown | null;
  thermalQqq: unknown | null;
  /** Compact SPX 0DTE matrix (GEX/VEX/DEX/CHARM scalars + near-spot ladder — not full cell grid). */
  thermalMatrix: unknown | null;
  /** Vector SPX 0DTE desk scalars + play. */
  vectorSpx: unknown | null;
  /** 0DTE Command board summary. */
  zerodte: unknown | null;
  /** HELIX regime detector snapshot. */
  regime: unknown | null;
  /** get_market_context tool payload — indices, tide, breadth. */
  marketContext: unknown | null;
  /** Per-loader errors (name → message) for observability; empty when all succeeded. */
  errors: Record<string, string>;
};

export const BIE_FULL_STATE_CACHE_KEY = "bie:full-state";
/** TTL comfortably outlives the ~5-min cron cadence; asOf discloses staleness. */
export const BIE_FULL_STATE_TTL_SEC = 15 * 60;

export async function readBieFullState(): Promise<BieFullState | null> {
  try {
    return await sharedCacheGet<BieFullState>(BIE_FULL_STATE_CACHE_KEY);
  } catch {
    return null;
  }
}

export async function writeBieFullState(state: BieFullState): Promise<void> {
  try {
    await sharedCacheSet(BIE_FULL_STATE_CACHE_KEY, state, BIE_FULL_STATE_TTL_SEC);
  } catch {
    /* best-effort warm */
  }
}
