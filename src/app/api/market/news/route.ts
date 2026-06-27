import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";
import { serverCache, TTL } from "@/lib/server-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!polygonConfigured()) {
    return NextResponse.json({ error: "POLYGON_API_KEY not configured", articles: [] }, { status: 503 });
  }

  // News is market-wide (not user-personalized). 120s CDN cache reduces
  // upstream Polygon/Benzinga calls under load; auth gate above enforces entitlement.
  const CDN_CACHE = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=30" };

  try {
    const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim() || undefined;
    // When a ticker is requested, fetch a larger batch and filter by tickers array.
    // The Benzinga news API doesn't support per-ticker filtering natively, so we over-fetch
    // a fresh batch (no cache key collision with the market-wide key) and client-filter.
    if (ticker) {
      const cacheKey = `news:benzinga:ticker:${ticker}`;
      const all = await serverCache(cacheKey, 60, () => fetchBenzingaNews(50));
      const filtered = all.filter(
        (a: { tickers?: string[] }) =>
          Array.isArray(a.tickers) && a.tickers.some((t: string) => t.toUpperCase() === ticker),
      );
      return NextResponse.json({ source: "benzinga", ticker, articles: filtered }, { headers: CDN_CACHE });
    }
    const articles = await serverCache("news:benzinga:15", TTL.NEWS, () => fetchBenzingaNews(15));
    return NextResponse.json({ source: "benzinga", articles }, { headers: CDN_CACHE });
  } catch (error) {
    console.error("[market/news]", error);
    return NextResponse.json({ error: "News fetch failed" }, { status: 502 });
  }
}
