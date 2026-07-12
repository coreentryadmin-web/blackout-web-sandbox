import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { buildGexLadder } from "@/features/vector/lib/vector-gex-ladder";
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

  const hm = await fetchGexHeatmap(ticker).catch(() => null);
  const spot = hm?.spot ?? null;
  const ladder = buildGexLadder(hm?.gex?.strike_totals ?? null, spot);

  return NextResponse.json(
    roundFloats({ ticker, spot, asOf: hm?.asof ?? null, ladder })
  );
}
