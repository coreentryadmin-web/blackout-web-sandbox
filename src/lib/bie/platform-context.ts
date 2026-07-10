import "server-only";

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { getPlatformSnapshot, type PlatformSnapshot } from "@/lib/platform";
import {
  loadSpxBriefIntel,
  type SpxBriefIntelPrefetch,
  type SpxBriefIntelPrev,
} from "@/lib/bie/load-spx-brief-intel";
import type { SpxDeskBriefIntel } from "@/lib/bie/spx-desk-intel";
import { searchKnowledge, type RetrievedChunk } from "@/lib/bie/knowledge";
import { getLatestNightHawkEdition } from "@/lib/platform/nighthawk-service";
import { runLargoTool } from "@/lib/largo/run-tool";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";

export { formatKnowledgeFootnotes } from "@/lib/bie/platform-footnotes";

export type BieCrossEngineState = {
  openPlay: import("@/features/spx/lib/spx-play-store").OpenPlayRow | null;
  lotto: import("@/features/spx/lib/spx-lotto-store").LottoRecord | null;
  powerHour: import("@/features/spx/lib/spx-power-hour-store").PowerHourRecord | null;
  outcomes: import("@/features/spx/lib/spx-play-outcomes").PlayOutcomeStats | null;
};

export type BiePlatformContext = {
  as_of: string;
  snapshot: PlatformSnapshot;
  desk: SpxDeskPayload | null;
  intel: SpxDeskBriefIntel | null;
  nighthawk: NightHawkEdition | null;
  regime: Record<string, unknown> | null;
  cross: BieCrossEngineState;
  knowledge: RetrievedChunk[];
};

export type LoadBiePlatformContextOpts = {
  scope?: "desk" | "market" | "full";
  intelPrev?: SpxBriefIntelPrev | null;
  /** Off by default on hot paths — Voyage embed adds 200–800ms. Enable only when needed. */
  knowledgeQuery?: string | null;
  flowLimit?: number;
};

async function loadCrossEngineState(): Promise<BieCrossEngineState> {
  const [openPlay, lotto, powerHour, outcomes] = await Promise.all([
    import("@/features/spx/lib/spx-play-store").then((m) => m.loadOpenPlay()).catch(() => null),
    import("@/features/spx/lib/spx-lotto-store").then((m) => m.loadLottoRecord()).catch(() => null),
    import("@/features/spx/lib/spx-power-hour-store").then((m) => m.loadPowerHourRecord()).catch(() => null),
    import("@/features/spx/lib/spx-play-outcomes").then((m) => m.fetchPlayOutcomeStats()).catch(() => null),
  ]);
  return { openPlay, lotto, powerHour, outcomes };
}

function emptySnapshot(as_of: string): PlatformSnapshot {
  return { as_of };
}

/** Desk-only fast path — one parallel batch, no snapshot/regime/knowledge. */
async function loadDeskPlatformContext(
  as_of: string,
  intelPrev?: SpxBriefIntelPrev | null
): Promise<BiePlatformContext> {
  const [deskResult, nighthawk, cross, positioning, heatmap] = await Promise.all([
    loadMergedSpxDesk().catch(() => ({ merged: null as SpxDeskPayload | null })),
    getLatestNightHawkEdition().catch(() => null),
    loadCrossEngineState(),
    getGexPositioning("SPX", { includeIntradayAdjusted: true }).catch(() => null),
    fetchGexHeatmap("SPX").catch(() => null),
  ]);

  const desk =
    deskResult.merged?.available && deskResult.merged.price != null && deskResult.merged.price > 0
      ? deskResult.merged
      : null;

  const prefetch: SpxBriefIntelPrefetch = { positioning, heatmap };
  let intel: SpxDeskBriefIntel | null = null;
  if (desk) {
    intel = await loadSpxBriefIntel(
      desk,
      {
        desk: intelPrev?.desk ?? null,
        positioning: intelPrev?.positioning ?? null,
        heatmapSlice: intelPrev?.heatmapSlice ?? null,
        prevNighthawk: intelPrev?.prevNighthawk ?? null,
        nighthawk: intelPrev?.nighthawk ?? nighthawk,
      },
      nighthawk,
      intelPrev?.prevNighthawk ?? null,
      prefetch
    );
  }

  return {
    as_of,
    snapshot: emptySnapshot(as_of),
    desk,
    intel,
    nighthawk,
    regime: null,
    cross,
    knowledge: [],
  };
}

/** Market-only fast path — snapshot + regime in parallel; no full desk merge. */
async function loadMarketPlatformContext(
  as_of: string,
  flowLimit: number
): Promise<BiePlatformContext> {
  const [snapshot, regime, cross] = await Promise.all([
    getPlatformSnapshot({
      include: ["spx", "flows", "nighthawk"],
      flowLimit,
      fullEdition: false,
    }),
    runLargoTool("get_market_regime", {}).catch(() => null) as Promise<Record<string, unknown> | null>,
    loadCrossEngineState(),
  ]);

  const regimeClean =
    regime && typeof regime === "object" && !(regime as { error?: unknown }).error ? regime : null;

  return {
    as_of,
    snapshot,
    desk: null,
    intel: null,
    nighthawk: null,
    regime: regimeClean,
    cross,
    knowledge: [],
  };
}

/**
 * Unified BIE data plane — scope-aware parallel fan-out.
 * `desk` scope avoids duplicate snapshot/regime/Voyage work (hot Largo path).
 */
export async function loadBiePlatformContext(
  opts: LoadBiePlatformContextOpts = {}
): Promise<BiePlatformContext> {
  const scope = opts.scope ?? "full";
  const as_of = new Date().toISOString();

  if (scope === "desk") {
    return loadDeskPlatformContext(as_of, opts.intelPrev);
  }

  if (scope === "market" && !opts.knowledgeQuery?.trim()) {
    return loadMarketPlatformContext(as_of, opts.flowLimit ?? 24);
  }

  const needDesk = scope === "full";
  const knowledgePromise = opts.knowledgeQuery?.trim()
    ? searchKnowledge(opts.knowledgeQuery.trim(), 3).catch(() => [])
    : Promise.resolve([] as RetrievedChunk[]);

  const [
    snapshot,
    deskResult,
    nighthawk,
    regime,
    cross,
    knowledge,
  ] = await Promise.all([
    getPlatformSnapshot({
      include: ["spx", "flows", "nighthawk"],
      flowLimit: opts.flowLimit ?? 40,
      fullEdition: false,
    }),
    needDesk
      ? loadMergedSpxDesk().catch(() => ({ merged: null as SpxDeskPayload | null }))
      : Promise.resolve({ merged: null as SpxDeskPayload | null }),
    getLatestNightHawkEdition().catch(() => null),
    runLargoTool("get_market_regime", {}).catch(() => null) as Promise<Record<string, unknown> | null>,
    loadCrossEngineState(),
    knowledgePromise,
  ]);

  const desk =
    deskResult.merged?.available && deskResult.merged.price != null && deskResult.merged.price > 0
      ? deskResult.merged
      : null;

  let intel: SpxDeskBriefIntel | null = null;
  if (desk) {
    intel = await loadSpxBriefIntel(desk, {
      desk: opts.intelPrev?.desk ?? null,
      positioning: opts.intelPrev?.positioning ?? null,
      heatmapSlice: opts.intelPrev?.heatmapSlice ?? null,
      prevNighthawk: opts.intelPrev?.prevNighthawk ?? null,
      nighthawk: opts.intelPrev?.nighthawk ?? nighthawk,
    }, nighthawk, opts.intelPrev?.prevNighthawk ?? null);
  }

  const regimeClean =
    regime && typeof regime === "object" && !(regime as { error?: unknown }).error ? regime : null;

  return {
    as_of,
    snapshot,
    desk,
    intel,
    nighthawk,
    regime: regimeClean,
    cross,
    knowledge,
  };
}
