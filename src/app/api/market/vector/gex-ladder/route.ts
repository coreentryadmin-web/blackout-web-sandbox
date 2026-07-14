import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { buildGexLadder } from "@/features/vector/lib/vector-gex-ladder";
import { getHorizonStrikeTotals } from "@/features/vector/lib/vector-dte-walls-server";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-strike GEX ladder for the Vector strike-ladder side panel — the dense per-strike net-GEX
 * column a member scans next to the chart (Skylit-Atlas parity). Kept off the per-second SSE
 * payload (like the walls route) so the shared per-ticker stream fan-out stays lean; the panel
 * polls this on its own cadence.
 *
 * Data source is the SAME near-term aggregate that feeds the chart's default ("all") walls —
 * `GexHeatmap.gex.strike_totals` (strike → signed net GEX). `buildGexLadder` bands it around spot
 * and returns display-ready rows. Rounded at the data layer (repo policy — `strike_totals` are raw
 * provider floats). Horizon-scoping the ladder to the chart's DTE toggle is a documented follow-up.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: `Invalid ticker` }, { status: 400 });
  }
  const ticker = normalizeVectorTicker(rawTicker);
  const horizon = normalizeDteHorizon(req.nextUrl.searchParams.get("dte"));

  // Scope the ladder to the horizon's expiries via the SAME per-expiry reconstruction ladder the DTE
  // walls use (a wide banded chain, ~[spot·0.7, spot·1.35]), so the panel matches the chart's DTE
  // toggle AND — critically — includes the full gamma structure. This now runs for "all" too, not
  // just narrowed horizons: the old "all" path read the ±12%-strike-banded heatmap `strike_totals`,
  // which on a low-priced / high-IV name truncates the ladder to a tiny window (FIG spot ~23.2 →
  // strikes [20,26] only) and PINS the −GEX peak / put wall at the band's edge (strike 20) instead
  // of the true put wall (17.5), while dropping the fat call wall at 30 (OI 47k). The per-expiry
  // path bands far wider ([16,32] for FIG) so the true walls render and the "all" ladder is never
  // NARROWER than its own weekly/monthly views. When the scoped fetch yields nothing (thin chain,
  // off-hours, non-optionable) we fall back to the near-term heatmap aggregate so the panel is never
  // blanked. See docs/audit/FINDINGS.md — GEX-vs-Skylit forensic.
  const scoped = await getHorizonStrikeTotals(ticker, horizon).catch(() => null);
  if (scoped) {
    const ladder = buildGexLadder(scoped.strikeTotals, scoped.spot);
    return NextResponse.json(
      roundFloats({ ticker, spot: scoped.spot, asOf: null, horizon, ladder })
    );
  }

  const hm = await fetchGexHeatmap(ticker).catch(() => null);
  const spot = hm?.spot ?? null;
  const ladder = buildGexLadder(hm?.gex?.strike_totals ?? null, spot);

  return NextResponse.json(
    roundFloats({ ticker, spot, asOf: hm?.asof ?? null, horizon, ladder })
  );
}
