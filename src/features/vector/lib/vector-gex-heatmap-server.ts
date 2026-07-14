import "server-only";

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { normalizeVectorTicker } from "./vector-ticker";
import { loadCurrentChainContracts, loadSessionSpotSamples } from "./vector-gex-reconstruct-server";
import { reconstructGexHeatmapGrid, type GexHeatmapGrid } from "./vector-gex-reconstruct";
import { expiriesForHorizon, type VectorDteHorizon } from "./vector-dte-horizon";

/**
 * Horizon-scoped strike×time GEX positioning surface for a ticker — the server shell behind the
 * Vector chart's background heatmap (task #14). x = time (the session's real intraday spot path),
 * y = strike, cell = signed net dealer GEX (+ call / − put).
 *
 * Built from the SAME inputs as the DTE walls the member already sees, so the heatmap and the walls
 * can never describe different positioning:
 *   1. live spot (getGexPositioning) → bands the current options chain
 *   2. current banded chain (loadCurrentChainContracts, Redis-cached 10min — reused, no extra load)
 *   3. filter to the horizon's expiries (expiriesForHorizon) → this is what makes it DTE-AWARE:
 *      0dte/weekly/monthly narrow the surface to their expiries exactly like the walls/max-pain/cone
 *   4. the session's downsampled spot path (loadSessionSpotSamples) → the x (time) axis
 *   5. reconstructGexHeatmapGrid over the horizon's contracts along that spot path → the grid
 *
 * The gamma T is measured from `todayEtYmd()` (current OI/IV, T from now) — the same convention the
 * per-expiry walls use — so the surface is a "current positioning, as it migrated across the
 * session's spot path" view, consistent with the live walls rather than a past-session snapshot.
 *
 * Best-effort: returns null on any gap (no spot, empty chain, empty horizon, no session bars, thrown
 * fetch). A live overlay must degrade to "no surface" rather than error or fabricate — the client
 * draws nothing on null.
 */
export async function getVectorGexHeatmap(
  ticker: string,
  horizon: VectorDteHorizon,
  sessionYmd: string
): Promise<GexHeatmapGrid | null> {
  const t = normalizeVectorTicker(ticker);
  try {
    const pos = await getGexPositioning(t);
    const spot = pos?.spot;
    if (!(spot && spot > 0)) return null;

    const contracts = await loadCurrentChainContracts(t, spot);
    if (!contracts.length) return null;

    const today = todayEtYmd();
    const expiries = [...new Set(contracts.map((c) => c.expiry))].sort();
    const scoped = new Set(expiriesForHorizon(expiries, horizon, today));
    if (scoped.size === 0) return null;
    const filtered = contracts.filter((c) => scoped.has(c.expiry));
    if (!filtered.length) return null;

    // The x-axis is the session's real spot path. Off-hours this is the last session's bars (a sparse
    // surface is honest); live it's open→now. A bad/empty session simply yields no grid.
    const spots = await loadSessionSpotSamples(t, sessionYmd);
    if (!spots.length) return null;

    const grid = reconstructGexHeatmapGrid(filtered, spots, today);
    // times.length === 0 means every ladder was empty — return null so the client draws nothing.
    return grid.times.length ? grid : null;
  } catch {
    return null; // live overlay: fall back to no surface, never throw
  }
}
