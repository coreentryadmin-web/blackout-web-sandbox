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

  // targetSessions=3 pins this endpoint to its PRE-multi-day depth (3 sessions, all native 1m —
  // identical output to before the 15-session page seed). The route exists to backfill bars that
  // closed while a live SSE connection was down — always a hole in TODAY's session — so the deep
  // 15-day context (which ships once in the page's SSR seed, priors decimated to 5m) must not be
  // re-fetched here on every client reconnect: 15 Polygon calls per reconnect, and its 5m prior
  // days would collide with these 1m rows in the client's merge-by-time union.
  const { bars, sessionYmd } = await fetchVectorSeedBars(
    ticker,
    undefined,
    undefined,
    undefined,
    undefined,
    3
  );
  return NextResponse.json({ ticker, sessionYmd, bars, available: bars.length > 0 });
}
