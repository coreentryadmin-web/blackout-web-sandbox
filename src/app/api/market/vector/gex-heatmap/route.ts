import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { getVectorGexHeatmap } from "@/features/vector/lib/vector-gex-heatmap-server";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Horizon-scoped strike×time GEX positioning surface — the read behind the Vector chart's background
 * heatmap (task #14, the "gex-heatmap" indicator). Kept off the per-second SSE payload (like the
 * walls / max-pain / expected-move routes) so the shared per-ticker stream stays lean; the client
 * fetches this once per ticker/DTE toggle and hands the grid to the chart's background primitive.
 *
 * Same gate as the sibling Vector reads (authorizeMarketDeskApi + requireToolApi("vector") + ticker
 * allowlist + normalizeDteHorizon). `session` is the ET session date the chart is displaying (its
 * bars provide the x/time axis); absent/invalid falls back to today so a live "all" view still draws.
 *
 * `grid` is `roundFloats`-shaped at the data layer (the cells are dollar-gamma sums with IEEE float
 * noise) and is `null` when there's no honest surface to draw (no chain / horizon / session bars) —
 * the client then renders nothing rather than a fabricated surface.
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
  const rawSession = req.nextUrl.searchParams.get("session") ?? "";
  const session = /^\d{4}-\d{2}-\d{2}$/.test(rawSession) ? rawSession : todayEtYmd();

  const grid = await getVectorGexHeatmap(ticker, horizon, session);
  return NextResponse.json(
    roundFloats({
      ticker,
      horizon,
      sessionYmd: session,
      grid,
    })
  );
}
