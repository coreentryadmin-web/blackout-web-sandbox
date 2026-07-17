// Redis cache for Vector Pulse transition state — mirrors the client-side prevSnapshotRef +
// seenMapRef in VectorPulse.tsx so Largo can detect regime flips, proximity escalations, and
// new wall-structure events between turns without re-running the chart.

import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { PulseSnapshot, PlayStateSnapshot } from "@/features/vector/lib/vector-pulse";

export type VectorPulseCacheEntry = {
  snapshot: PulseSnapshot;
  seenAtByKey: Record<string, number>;
  /** Wall events already surfaced in the pulse feed (slice index into wallEvents). */
  processedWallEventCount: number;
  /** SPX play-engine phase snapshot for transition detection (SPX only). */
  playState?: PlayStateSnapshot | null;
  /** Flow alert ids already emitted this session. */
  seenFlowIds?: string[];
  updatedAt: string;
};

export const VECTOR_PULSE_CACHE_TTL_SEC = 20 * 60;

export function vectorPulseCacheKey(ticker: string, horizon: VectorDteHorizon): string {
  return `vector:pulse:snapshot:${normalizeVectorTicker(ticker)}:${horizon}`;
}

export async function readVectorPulseCache(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<VectorPulseCacheEntry | null> {
  try {
    return await sharedCacheGet<VectorPulseCacheEntry>(vectorPulseCacheKey(ticker, horizon));
  } catch {
    return null;
  }
}

export async function writeVectorPulseCache(
  ticker: string,
  horizon: VectorDteHorizon,
  entry: VectorPulseCacheEntry
): Promise<void> {
  try {
    await sharedCacheSet(vectorPulseCacheKey(ticker, horizon), entry, VECTOR_PULSE_CACHE_TTL_SEC);
  } catch {
    /* best-effort */
  }
}
