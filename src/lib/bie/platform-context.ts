import "server-only";

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { getPlatformSnapshot, type PlatformSnapshot } from "@/lib/platform";
import { loadSpxBriefIntel, type SpxBriefIntelPrev } from "@/lib/bie/load-spx-brief-intel";
import type { SpxDeskBriefIntel } from "@/lib/bie/spx-desk-intel";
import { searchKnowledge, type RetrievedChunk } from "@/lib/bie/knowledge";
import { getLatestNightHawkEdition } from "@/lib/platform/nighthawk-service";
import { runLargoTool } from "@/lib/largo/run-tool";
import { formatKnowledgeFootnotes } from "@/lib/bie/platform-footnotes";

export { formatKnowledgeFootnotes } from "@/lib/bie/platform-footnotes";

export type BieCrossEngineState = {
  openPlay: import("@/features/spx/lib/spx-play-store").OpenPlayRow | null;
  lotto: import("@/features/spx/lib/spx-lotto-store").LottoRecord | null;
  powerHour: import("@/features/spx/lib/spx-power-hour-store").PowerHourRecord | null;
  outcomes: import("@/features/spx/lib/spx-play-outcomes").PlayOutcomeStats | null;
};

export type BiePlatformContext = {
  as_of: string;
  /** Cross-service snapshot — SPX summary, HELIX tape, Night Hawk (same readers as Largo tools). */
  snapshot: PlatformSnapshot;
  /** Full merged SPX desk when scope includes desk (UW + Polygon + WS caches). */
  desk: SpxDeskPayload | null;
  /** Matrix greeks, heatmap walls, material intel edges. */
  intel: SpxDeskBriefIntel | null;
  /** Latest Night Hawk edition from RDS (full plays, not summary-only). */
  nighthawk: NightHawkEdition | null;
  /** HELIX market-regime detector snapshot from RDS (via get_market_regime tool reader). */
  regime: Record<string, unknown> | null;
  /** SPX play engine cross-state from RDS. */
  cross: BieCrossEngineState;
  /** Voyage-retrieved desk knowledge chunks (playbooks, findings, precedents) — no Claude. */
  knowledge: RetrievedChunk[];
};

export type LoadBiePlatformContextOpts = {
  /** desk = full SPX desk + intel; market = snapshot + regime only; full = everything. */
  scope?: "desk" | "market" | "full";
  intelPrev?: SpxBriefIntelPrev | null;
  /** When set, runs searchKnowledge() against bie_knowledge (RDS embeddings). */
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

/**
 * Unified BIE data plane — one parallel fan-out across every platform service.
 *
 * Does NOT open raw Redis or ad-hoc SQL. Each field routes through the same
 * service modules dashboards and Largo tools use (those modules already sit on
 * RDS + ElastiCache shared-cache keys). Commentary / Largo composers call this
 * once per cache miss instead of re-implementing partial loaders.
 */
export async function loadBiePlatformContext(
  opts: LoadBiePlatformContextOpts = {}
): Promise<BiePlatformContext> {
  const scope = opts.scope ?? "full";
  const as_of = new Date().toISOString();
  const needDesk = scope === "desk" || scope === "full";

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
    opts.knowledgeQuery?.trim()
      ? searchKnowledge(opts.knowledgeQuery.trim(), 3).catch(() => [])
      : Promise.resolve([] as RetrievedChunk[]),
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
    });
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
