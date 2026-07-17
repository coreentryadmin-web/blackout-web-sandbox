import "server-only";

import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { getCachedBiePlatformContext } from "@/lib/bie/platform-cache";
import { createLargoStatusTicker } from "@/lib/bie/largo-status";

/** Max wait for desk/market caches on a cold ECS task before routing (ms). */
export const LARGO_LIVE_PREFETCH_BLOCK_MS = 2_500;

export type LargoLivePrefetchOpts = {
  /** 0 = fire-and-forget; default LARGO_LIVE_PREFETCH_BLOCK_MS. */
  blockMs?: number;
  /** Optional status callback (stream UI) while warming caches. */
  onStatus?: (message: string) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Boot data sockets + seed BIE platform context so Largo's first turn on a cold
 * task reads the same live Polygon/UW-backed caches as the SPX desk (not a cold
 * composer miss). Non-fatal: any warm failure is swallowed; routing proceeds.
 */
export async function prefetchLargoLiveFeed(opts?: LargoLivePrefetchOpts): Promise<void> {
  try {
    ensureDataSockets();
  } catch {
    /* socket init must never block Largo */
  }

  const blockMs = opts?.blockMs ?? LARGO_LIVE_PREFETCH_BLOCK_MS;
  const onStatus = opts?.onStatus;
  const ticker =
    onStatus && blockMs > 0
      ? createLargoStatusTicker({ phase: "prefetch", onStatus, intervalMs: 850 })
      : null;
  ticker?.start();

  const warm = Promise.all([
    getCachedBiePlatformContext({ scope: "desk" }),
    getCachedBiePlatformContext({ scope: "market" }),
  ]).catch(() => undefined);

  if (blockMs <= 0) {
    void warm;
    ticker?.stop();
    return;
  }
  try {
    await Promise.race([warm, sleep(blockMs)]);
  } finally {
    ticker?.stop();
  }
}
