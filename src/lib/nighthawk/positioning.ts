import {
  analyzeStrikeGexRows,
  computeGammaFlip,
  gammaRegime,
  topGexWalls,
} from "@/lib/providers/gamma-desk";
import { polygonConfigured } from "@/lib/providers/config";
import { fetchPolygonPositioningBundle } from "@/lib/providers/polygon-options-gex";
import { fetchStockSnapshot } from "@/lib/providers/polygon";
import { getGexPositioning } from "@/lib/providers/gex-positioning";

export type PositioningSummary = {
  net_gex: number;
  gex_king_strike: number | null;
  gamma_flip: number | null;
  gamma_regime: string;
  net_vex: number | null;
  max_pain: number | null;
  negative_gamma: boolean;
  wall_summary: string;
  source?: "polygon" | "unusual_whales";
};

function rowVex(row: Record<string, unknown>): number {
  const callV = Number(row.call_vanna_oi ?? row.call_vex ?? row.vanna_call ?? 0);
  const putV = Number(row.put_vanna_oi ?? row.put_vex ?? row.vanna_put ?? 0);
  if (callV !== 0 || putV !== 0) return callV + putV;
  return Number(row.vex ?? row.vanna_exposure ?? row.net_vanna ?? 0);
}

function buildSummary(
  rows: Record<string, unknown>[],
  spot: number,
  maxPain: number | null,
  source: "polygon" | "unusual_whales"
): PositioningSummary {
  const gex = analyzeStrikeGexRows(rows);
  const flip = spot > 0 ? computeGammaFlip(gex.ranked_levels, spot) : null;
  const regime = gammaRegime(spot, flip);
  const walls = spot > 0 ? topGexWalls(gex.ranked_levels, spot, 4) : [];
  const wallSummary = walls.length
    ? walls
        .map((w) => {
          // Name the wall by net_gex SIGN (put wall = support, call wall = resistance),
          // matching the Heatmap / Night's Watch / SPX-desk convention (#80) instead of
          // the geometric w.kind — so Largo's positioning read agrees with the Heatmap.
          // When spot has broken through (geometry disagrees), note the acting-as role.
          const hasSign = Number.isFinite(w.net_gex) && w.net_gex !== 0;
          const isPut = w.net_gex < 0;
          const nativeRole = isPut ? "support" : "resistance";
          const role = !hasSign
            ? w.kind
            : w.kind === nativeRole
              ? `${isPut ? "put" : "call"} wall`
              : `${isPut ? "put" : "call"} wall (acting as ${w.kind})`;
          return `${role} $${w.strike} (${w.distance_pts >= 0 ? "+" : ""}${w.distance_pts}pts)`;
        })
        .join(" · ")
    : "n/a";

  let netVex = 0;
  let hasVex = false;
  for (const row of rows) {
    const v = rowVex(row);
    if (v !== 0) {
      hasVex = true;
      netVex += v;
    }
  }

  return {
    net_gex: gex.net_gex,
    gex_king_strike: gex.gex_king_strike,
    gamma_flip: flip,
    gamma_regime: regime,
    net_vex: hasVex ? netVex : null,
    max_pain: maxPain,
    negative_gamma: gex.net_gex < 0,
    wall_summary: wallSummary,
    source,
  };
}

export async function fetchPositioningSummary(ticker: string): Promise<PositioningSummary> {
  const sym = ticker.toUpperCase();

  // PRIMARY: use the shared GEX matrix cache (getGexPositioning) — the same cache key
  // that Heatmaps, Largo, and the SPX desk all read. This collapses the Night Hawk GEX
  // path into the shared cache so all surfaces are guaranteed to agree on flip/walls/regime.
  // Falls through to the direct bundle only if the cache is cold or unavailable.
  try {
    const gex = await getGexPositioning(sym);
    if (gex && gex.spot > 0) {
      // Build PositioningSummary from the canonical positioning contract.
      const flip = gex.flip ?? null;
      const regime = gammaRegime(gex.spot, flip);
      // Reconstruct wall_summary from call_wall/put_wall.
      const walls: string[] = [];
      if (gex.call_wall != null) {
        const dist = +(gex.call_wall - gex.spot).toFixed(0);
        walls.push(`call wall $${gex.call_wall} (${dist >= 0 ? "+" : ""}${dist}pts)`);
      }
      if (gex.put_wall != null) {
        const dist = +(gex.put_wall - gex.spot).toFixed(0);
        walls.push(`put wall $${gex.put_wall} (${dist >= 0 ? "+" : ""}${dist}pts)`);
      }
      return {
        net_gex: gex.net_gex,
        gex_king_strike: gex.gex_king_strike,
        gamma_flip: flip,
        gamma_regime: regime,
        net_vex: gex.net_vex !== 0 ? gex.net_vex : null,
        max_pain: gex.max_pain ?? null,
        negative_gamma: gex.net_gex < 0,
        wall_summary: walls.length ? walls.join(" · ") : "n/a",
        source: "polygon",
      };
    }
  } catch (err) {
    console.warn("[nighthawk/positioning] getGexPositioning failed, falling back to direct bundle:", err);
  }

  // FALLBACK: direct fetchPolygonPositioningBundle call when the shared cache is cold.
  if (polygonConfigured()) {
    const bundle = await fetchPolygonPositioningBundle(sym);
    if (bundle.rows.length) {
      return buildSummary(bundle.rows, bundle.spot, bundle.maxPain, "polygon");
    }
  }

  // No Polygon data — return empty summary with current price.
  const snapshot = await fetchStockSnapshot(sym).catch(() => null);
  return buildSummary([], snapshot?.price ?? 0, null, "polygon");
}
