import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { fetchVectorSeedBars } from "@/features/vector/lib/vector-seed-bars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Closed minute bars for the Vector chart — the client's SSE-reconnect
 * backfill. The SSE carries only the currently-forming candle, so any bar
 * that closed while the connection was down (reconnect crossing a minute
 * boundary, replay window, tab sleep) was previously a permanent hole in the
 * session for the rest of the day, silently corrupting higher-timeframe
 * aggregates. Clients re-seed from here on every (re)connect.
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

  const { bars, sessionYmd } = await fetchVectorSeedBars(ticker);
  return NextResponse.json({ ticker, sessionYmd, bars, available: bars.length > 0 });
}
