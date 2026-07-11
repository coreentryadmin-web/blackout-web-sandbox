import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { getVectorGexWallsForHorizon } from "@/features/vector/lib/vector-snapshot";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GEX walls scoped to a DTE horizon — the read behind the Vector chart's DTE
 * toggle (0DTE / weekly / monthly / all). Kept off the per-second SSE payload so
 * the shared per-ticker stream fan-out stays intact; the client fetches this
 * once per toggle and repaints. Horizon re-scoping only refines oracle tickers
 * (SPX/SPY/QQQ, which carry the per-expiry ladder) — see
 * getVectorGexWallsForHorizon; others return their near-term walls unchanged.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const ticker = normalizeVectorTicker(req.nextUrl.searchParams.get("ticker"));
  if (!vectorUniverseTickers().includes(ticker)) {
    return NextResponse.json({ error: `Unknown Vector ticker: ${ticker}` }, { status: 400 });
  }

  const horizon = normalizeDteHorizon(req.nextUrl.searchParams.get("dte"));
  const walls = await getVectorGexWallsForHorizon(ticker, horizon);
  return NextResponse.json({ ticker, horizon, walls });
}
