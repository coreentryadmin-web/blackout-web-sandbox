import "server-only";

// buildBieFullState — assembles the broad, cross-product platform snapshot the 24/7 cron writes to
// Redis (bie:full-state). One Promise.all over the existing platform loaders, each FAIL-OPEN per
// loader (a single loader failing must never blank the whole snapshot — its error is recorded and
// its field is null), then rounded + written. No new provider calls: every loader is the same one
// the dashboards / dedicated tools already use.

import { getPlatformSnapshot } from "@/lib/platform";
import { fetchPlatformIntelSnapshot } from "@/features/nighthawk/lib/platform-intel-snapshot";
import { refreshVectorUniverseSnapshot } from "@/features/vector/lib/vector-universe";
import { fetchUwDarkPoolMarketWide } from "@/lib/providers/unusual-whales";
import { fetchHotTickers } from "@/lib/bie/hot-tickers";
import { roundFloats } from "@/lib/round-floats";
import { writeBieFullState, type BieFullState } from "@/lib/bie/full-platform-cache";

/** Run a loader fail-open, recording its error under `name` instead of letting it reject the all. */
async function safe<T>(name: string, errors: Record<string, string>, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    errors[name] = e instanceof Error ? e.message : String(e);
    return null;
  }
}

/**
 * Build the full-platform snapshot and write it to bie:full-state. Returns the snapshot (+ a summary
 * the cron logs). Every loader is independent and fail-open, so a partial platform outage still
 * produces a useful, honestly-annotated snapshot.
 */
export async function buildBieFullState(): Promise<BieFullState> {
  const errors: Record<string, string> = {};

  const [platform, intel, vectorUniverse, darkPool, hotTickers] = await Promise.all([
    // getPlatformSnapshot bundles the SPX desk + flow tape + Night Hawk edition in one call.
    safe("platform", errors, () => getPlatformSnapshot({ include: ["spx", "flows", "nighthawk"], fullEdition: true })),
    safe("intel", errors, () => fetchPlatformIntelSnapshot()),
    // The cron does NOT record wall history here (that's the vector-universe-snapshot cron's job) —
    // this only reads the summary rows, so pass no recording opts.
    safe("vectorUniverse", errors, () => refreshVectorUniverseSnapshot()),
    safe("darkPool", errors, () => fetchUwDarkPoolMarketWide({ limit: 40 })),
    safe("hotTickers", errors, () => fetchHotTickers(8)),
  ]);

  const state: BieFullState = roundFloats<BieFullState>({
    asOf: new Date().toISOString(),
    platform: platform ?? null,
    intel: intel ?? null,
    vectorUniverse: vectorUniverse ?? null,
    darkPool: darkPool ?? null,
    hotTickers: hotTickers ?? null,
    errors,
  });

  await writeBieFullState(state);
  return state;
}
