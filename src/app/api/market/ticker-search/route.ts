import { NextRequest, NextResponse } from "next/server";
import { fetchPolygonTickerSearch } from "@/lib/providers/polygon-largo";
import { serverCache, TTL } from "@/lib/server-cache";
import { requireTierApi } from "@/lib/market-api-auth";

export async function GET(req: NextRequest) {
  // Require a signed-in user — the cache key is user-controlled (`search:${q}`), so the
  // cache is no defense against anonymous flooding of the paid Polygon/Massive API.
  const gate = await requireTierApi("free");
  if (gate instanceof Response) return gate;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  // Bound the key space: a tight allow-list + length cap stops an authed user from
  // minting unbounded distinct cache keys (memory pressure) or passing junk to the
  // paid upstream. Tickers/company-name fragments only ever need these chars.
  if (!q || q.length > 32 || !/^[A-Za-z0-9.\-& ]+$/.test(q)) {
    return NextResponse.json({ error: "invalid q param" }, { status: 400 });
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 10), 20);
  const results = await serverCache(
    `search:${q.toLowerCase()}:${limit}`,
    TTL.TICKER_SEARCH,
    () => fetchPolygonTickerSearch(q, limit)
  );
  return NextResponse.json({ results });
}
