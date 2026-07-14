import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { buildGexLadder } from "@/features/vector/lib/vector-gex-ladder";
import { getHorizonStrikeTotals } from "@/features/vector/lib/vector-dte-walls-server";
import { getFlowStrikeTotals } from "@/features/vector/lib/vector-flow-gex-server";
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
 * Data source is the per-expiry reconstruction chain (`getHorizonStrikeTotals`, a wide banded
 * chain ~[spot·0.7, spot·1.35]) for EVERY horizon incl. "all", with the near-term heatmap aggregate
 * as fallback. `buildGexLadder` turns that `{strike: netGex}` map into display-ready rows — DENSE by
 * default (every material strike the chain carries, Skylit parity), not a tight near-money slice.
 * Rounded at the data layer (repo policy — `strike_totals` are raw provider floats).
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
  // GEX signing mode: `oi` (canonical, DEFAULT — today's static call+/put− on open interest) or
  // `flow` (the FLOW-GEX lens — today's directional traded flow signs each strike, Skylit parity).
  // Anything other than an explicit `flow` falls back to `oi` so the default path is never altered.
  const mode = req.nextUrl.searchParams.get("mode") === "flow" ? "flow" : "oi";

  // FLOW lens — the flow-signed dealer-gamma ladder from UW's bid/ask gamma decomposition. Same
  // `{strike: netGex}` → `buildGexLadder` rendering as `oi`, only the per-strike SIGN + magnitude
  // source differs. Inherently ALL-EXPIRY (the `spot-exposures/strike` aggregate), so the DTE toggle
  // doesn't re-scope it; the horizon is still echoed for the client. On any gap we render an empty
  // flow ladder (honest "unavailable") rather than silently falling back to OI and MISLABELLING it.
  if (mode === "flow") {
    const flow = await getFlowStrikeTotals(ticker).catch(() => null);
    const ladder = buildGexLadder(flow?.strikeTotals ?? null, flow?.spot ?? null);
    return NextResponse.json(
      roundFloats({ ticker, spot: flow?.spot ?? null, asOf: null, horizon, mode, ladder })
    );
  }

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
      roundFloats({ ticker, spot: scoped.spot, asOf: null, horizon, mode, ladder })
    );
  }

  const hm = await fetchGexHeatmap(ticker).catch(() => null);
  const spot = hm?.spot ?? null;
  const ladder = buildGexLadder(hm?.gex?.strike_totals ?? null, spot);

  return NextResponse.json(
    roundFloats({ ticker, spot, asOf: hm?.asof ?? null, horizon, mode, ladder })
  );
}
