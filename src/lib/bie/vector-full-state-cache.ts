// Redis snapshot cache for the Vector full-state — the "non-stop feed" read path.
//
// Side-effect-free (NO `import "server-only"`) so the key builder + round-trip are unit-testable
// under `tsx --test`; the type import of VectorFullState is erased at build time, so importing this
// never loads the server-only vector-full-state.ts graph.
//
// The continuous-ingestion cron (api/cron/vector-full-state-snapshot) writes a snapshot per
// (ticker, horizon) every RTH tick; readers (fetchVectorFullState, get_ecosystem_context, the
// get_vector_full_state Largo tool, composeVectorRead) read cache-first and only compute live on a
// miss — so BIE serves the current Vector state instantly without a per-query fan-out.

import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorFullState } from "@/lib/bie/vector-full-state";

/**
 * TTL for a cached snapshot. Chosen (like vector-universe's serve-stale) to comfortably outlive the
 * ~5-min RTH cron cadence so an entry never expires on the knife-edge between two runs; the
 * snapshot's own `asOf` discloses staleness to consumers. After the cron stops at the close, entries
 * age out within this window and off-hours reads fall back to a live compute (which self-warms).
 */
export const VECTOR_FULL_STATE_CACHE_TTL_SEC = 15 * 60;

/** `vector:full-state:{normalizedTicker}:{horizon}` — one snapshot per ticker+horizon. */
export function vectorFullStateCacheKey(ticker: string, horizon: VectorDteHorizon): string {
  return `vector:full-state:${normalizeVectorTicker(ticker)}:${horizon}`;
}

/** Read the cached snapshot, or null on miss / any cache error (never throws). */
export async function readVectorFullStateCache(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<VectorFullState | null> {
  try {
    return await sharedCacheGet<VectorFullState>(vectorFullStateCacheKey(ticker, horizon));
  } catch {
    return null;
  }
}

/** Write a snapshot to the cache (best-effort; a cache write must never fail the caller). */
export async function writeVectorFullStateCache(
  ticker: string,
  horizon: VectorDteHorizon,
  state: VectorFullState
): Promise<void> {
  try {
    await sharedCacheSet(vectorFullStateCacheKey(ticker, horizon), state, VECTOR_FULL_STATE_CACHE_TTL_SEC);
  } catch {
    /* best-effort warm — a cache write failure is not a caller failure */
  }
}
