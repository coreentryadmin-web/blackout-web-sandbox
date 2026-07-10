import "server-only";

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import {
  buildOdteIntelContext,
  heatmapToIntelSlice,
  type IntelHeatmapSlice,
} from "@/features/spx/lib/spx-odte-intel-feed";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import type { SpxDeskBriefIntel } from "@/lib/bie/spx-desk-intel";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";

export type SpxBriefIntelPrev = {
  desk?: SpxDeskPayload | null;
  positioning?: GexPositioning | null;
  heatmapSlice?: IntelHeatmapSlice | null;
  prevNighthawk?: NightHawkEdition | null;
  nighthawk?: NightHawkEdition | null;
};

/**
 * Load full BIE intel bundle — shared matrix (GEX/VEX/DEX/CHARM), material edges,
 * UW cross-validation. Reads the same caches as Thermal / Largo (zero extra UW RPS).
 */
export async function loadSpxBriefIntel(
  desk: SpxDeskPayload,
  prev?: SpxBriefIntelPrev | null,
  nighthawk?: NightHawkEdition | null,
  prevNighthawk?: NightHawkEdition | null
): Promise<SpxDeskBriefIntel> {
  const nh = nighthawk ?? prev?.nighthawk ?? null;
  const prevNh = prevNighthawk ?? prev?.prevNighthawk ?? null;

  const [positioning, heatmap] = await Promise.all([
    getGexPositioning("SPX", { includeIntradayAdjusted: true }).catch(() => null),
    fetchGexHeatmap("SPX").catch(() => null),
  ]);

  const heatmapSlice = heatmapToIntelSlice(heatmap);
  const seed = !prev?.desk?.price;
  const intelCtx = buildOdteIntelContext({
    prevDesk: prev?.desk ?? null,
    desk,
    prevHeatmap: prev?.heatmapSlice ?? null,
    heatmap: heatmapSlice,
    prevNighthawk: prevNh,
    nighthawk: nh,
    seed,
  });

  return {
    positioning,
    prevPositioning: prev?.positioning ?? null,
    heatmap,
    prevHeatmapSlice: prev?.heatmapSlice ?? null,
    intelLines: intelCtx.lines.filter((l) => l.trim().length > 0),
    nighthawk: nh,
    prevNighthawk: prevNh,
  };
}
