import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import {
  getVectorGexWallsForHorizon,
  getVectorGammaFlipForHorizon,
} from "@/features/vector/lib/vector-snapshot";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GEX walls scoped to a DTE horizon — the read behind the Vector chart's DTE
 * toggle (0DTE / weekly / monthly / all). Kept off the per-second SSE payload so
 * the shared per-ticker stream fan-out stays intact; the client fetches this
 * once per toggle and repaints. Horizon re-scoping now refines EVERY optionable
 * ticker: oracle names (SPX/SPY/QQQ) slice the live UW per-expiry ladder, others
 * compute per-expiry walls from the Polygon chain — see getVectorGexWallsForHorizon.
 * The response also carries the horizon-scoped gamma `flip` so the flip overlay line
 * re-scopes with the toggle, not just the walls.
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
  const [walls, flip] = await Promise.all([
    getVectorGexWallsForHorizon(ticker, horizon),
    getVectorGammaFlipForHorizon(ticker, horizon),
  ]);
  // Round at the data layer (repo policy). This route was the ONLY vector read missing roundFloats
  // (max-pain / gex-ladder / expected-move all round), so `flip` — a computed float — leaked full
  // precision (e.g. 7622.690014281115) to every consumer. Wall strikes are already listed strikes.
  return NextResponse.json(roundFloats({ ticker, horizon, walls, flip }));
}
