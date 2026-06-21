import {
  analyzeStrikeGexRows,
  computeGammaFlip,
  gammaRegime,
  topGexWalls,
} from "@/lib/providers/gamma-desk";
import { polygonConfigured } from "@/lib/providers/config";
import { fetchPolygonPositioningBundle } from "@/lib/providers/polygon-options-gex";
import { fetchStockSnapshot } from "@/lib/providers/polygon";

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
        .map((w) => `${w.kind} $${w.strike} (${w.distance_pts >= 0 ? "+" : ""}${w.distance_pts}pts)`)
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

  // Polygon is the sole GEX source — UW spot-exposures endpoints are 503 in production.
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
