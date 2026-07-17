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
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import {
  compactThermalMatrixSummary,
  compactThermalPositioning,
} from "@/lib/bie/thermal-matrix-summary";
import { zeroDtePlaysForLargo } from "@/lib/platform/zerodte-service";
import { runLargoTool } from "@/lib/largo/run-tool";

async function safe<T>(name: string, errors: Record<string, string>, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    errors[name] = e instanceof Error ? e.message : String(e);
    return null;
  }
}

function compactVectorSpx(state: unknown): unknown | null {
  const v = state as {
    spot?: number;
    gamma_flip?: number | null;
    regime?: { label?: string } | string | null;
    walls?: { call?: { strike?: number }; put?: { strike?: number } };
    play?: { bias?: string; conviction?: number; style?: string } | null;
    vexFlip?: number | null;
    asOf?: string;
  } | null;
  if (!v?.spot) return null;
  const regimeLabel =
    typeof v.regime === "string" ? v.regime : (v.regime as { label?: string } | null)?.label ?? null;
  return {
    spot: v.spot,
    gamma_flip: v.gamma_flip ?? null,
    gamma_regime: regimeLabel,
    call_wall: v.walls?.call?.strike ?? null,
    put_wall: v.walls?.put?.strike ?? null,
    play: v.play
      ? { bias: v.play.bias, conviction: v.play.conviction, style: v.play.style }
      : null,
    vex_flip: v.vexFlip ?? null,
    asOf: v.asOf ?? null,
  };
}

/**
 * Build the full-platform snapshot and write it to bie:full-state. Returns the snapshot (+ a summary
 * the cron logs). Every loader is independent and fail-open, so a partial platform outage still
 * produces a useful, honestly-annotated snapshot.
 */
export async function buildBieFullState(): Promise<BieFullState> {
  const errors: Record<string, string> = {};

  const [
    platform,
    intel,
    vectorUniverse,
    darkPool,
    hotTickers,
    thermalSpxRaw,
    thermalSpyRaw,
    thermalQqqRaw,
    heatmapRaw,
    vectorSpxRaw,
    zerodte,
    regime,
    marketContext,
  ] = await Promise.all([
    // getPlatformSnapshot bundles the SPX desk + flow tape + Night Hawk edition in one call.
    safe("platform", errors, () => getPlatformSnapshot({ include: ["spx", "flows", "nighthawk"], fullEdition: true })),
    safe("intel", errors, () => fetchPlatformIntelSnapshot()),
    safe("vectorUniverse", errors, () => refreshVectorUniverseSnapshot()),
    safe("darkPool", errors, () => fetchUwDarkPoolMarketWide({ limit: 40 })),
    safe("hotTickers", errors, () => fetchHotTickers(8)),
    safe("thermalSpx", errors, () => getGexPositioning("SPX", { includeIntradayAdjusted: true })),
    safe("thermalSpy", errors, () => getGexPositioning("SPY")),
    safe("thermalQqq", errors, () => getGexPositioning("QQQ")),
    safe("thermalMatrix", errors, () => fetchGexHeatmap("SPX")),
    safe("vectorSpx", errors, async () => {
      const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
      return fetchVectorFullState("SPX", "0dte");
    }),
    safe("zerodte", errors, () => zeroDtePlaysForLargo()),
    safe("regime", errors, () => runLargoTool("get_market_regime", {}) as Promise<Record<string, unknown>>),
    safe("marketContext", errors, () => runLargoTool("get_market_context", {}) as Promise<Record<string, unknown>>),
  ]);

  const state: BieFullState = roundFloats<BieFullState>({
    asOf: new Date().toISOString(),
    platform: platform ?? null,
    intel: intel ?? null,
    vectorUniverse: vectorUniverse ?? null,
    darkPool: darkPool ?? null,
    hotTickers: hotTickers ?? null,
    thermalSpx: compactThermalPositioning(thermalSpxRaw) ?? null,
    thermalSpy: compactThermalPositioning(thermalSpyRaw) ?? null,
    thermalQqq: compactThermalPositioning(thermalQqqRaw) ?? null,
    thermalMatrix: compactThermalMatrixSummary(heatmapRaw) ?? null,
    vectorSpx: compactVectorSpx(vectorSpxRaw),
    zerodte: zerodte ?? null,
    regime:
      regime && typeof regime === "object" && !(regime as { error?: unknown }).error ? regime : null,
    marketContext:
      marketContext && typeof marketContext === "object" && !(marketContext as { error?: unknown }).error
        ? marketContext
        : null,
    errors,
  });

  await writeBieFullState(state);
  return state;
}
