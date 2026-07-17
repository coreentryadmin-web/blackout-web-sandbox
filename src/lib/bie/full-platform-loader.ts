import "server-only";

import { readBieFullState, type BieFullState } from "@/lib/bie/full-platform-cache";
import { buildBieFullState } from "@/lib/bie/full-platform-snapshot";

const LIVE_MAX_AGE_MS = 5 * 60 * 1000;

function isFresh(state: BieFullState): boolean {
  const t = Date.parse(state.asOf);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= LIVE_MAX_AGE_MS;
}

/** Extended snapshot includes Thermal + Vector + 0DTE (post platform-read wiring). */
export function hasExtendedFullState(state: BieFullState): boolean {
  return state.thermalSpx !== undefined && state.thermalMatrix !== undefined;
}

/**
 * Largo/BIE read path for the cross-product snapshot.
 * Prefer Redis `bie:full-state` (cron-warmed); rebuild live when cold/stale/legacy shape.
 */
export async function getBieFullStateForLargo(opts?: { forceLive?: boolean }): Promise<BieFullState> {
  if (!opts?.forceLive) {
    const cached = await readBieFullState();
    if (cached && isFresh(cached) && hasExtendedFullState(cached)) {
      return cached;
    }
  }
  return buildBieFullState();
}
