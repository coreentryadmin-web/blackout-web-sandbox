/**
 * Vector walls cache pre-warming.
 * Called by /api/cron/vector-walls-warm to keep GEX/VEX walls hot so the SSE stream
 * (which ticks every 1s) sees cache hits instead of expensive re-computations.
 */

import { getVectorGexWalls, getVectorVexWalls } from "./vector-snapshot";
import { getActiveVectorTickers } from "./vector-stream-hub";

export async function warmVectorWalls(ticker: string): Promise<void> {
  // Force walls computation by calling the read functions.
  // These check the in-memory cache and re-compute if expired.
  // By running this cron frequently, we keep the cache warm for the SSE stream.
  await Promise.all([
    Promise.resolve(getVectorGexWalls(ticker)),
    Promise.resolve(getVectorVexWalls(ticker)),
  ]);
}

/** Get list of all tickers to warm: static allowlist + currently active dynamic tickers. */
export function getTickersToWarm(allowlist: string[]): string[] {
  const activeSet = new Set(getActiveVectorTickers());
  const allowlistSet = new Set(allowlist);
  // Combine: all allowlist tickers + any active dynamic tickers not already on allowlist
  return Array.from(
    new Set([...allowlistSet, ...activeSet])
  );
}
