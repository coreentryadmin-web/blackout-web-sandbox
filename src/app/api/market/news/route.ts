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
    return NextResponse.json({ error: "Market data unavailable", articles: [] }, { status: 503 });
  }

  // News is market-wide (not user-personalized). 120s CDN cache reduces
  // upstream Polygon/Benzinga calls under load; auth gate above enforces entitlement.
  const CDN_CACHE = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=30" };

  try {
    const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim() || undefined;
    if (ticker) {
      // Use Benzinga's native tickers.any_of filter — returns all market coverage for this
      // stock: earnings, analyst calls, news mentions, sector commentary that names the ticker.
      // This is far broader than a post-fetch client-side filter on the tickers[] array.
      const cacheKey = `news:benzinga:ticker:${ticker}`;
      // TTL is in MILLISECONDS. This previously passed `60` (60ms — intended as 60s),
      // so ticker-mode news was effectively uncached and every member poll hit
      // Benzinga upstream directly.
      const articles = await serverCache(cacheKey, TTL.TICKER_NEWS, () => fetchBenzingaNews(50, { ticker }));
      return NextResponse.json({ source: "news", ticker, articles }, { headers: CDN_CACHE });
    }
    const articles = await serverCache("news:benzinga:15", TTL.NEWS, () => fetchBenzingaNews(15));
    return NextResponse.json({ source: "news", articles }, { headers: CDN_CACHE });
  } catch (error) {
    console.error("[market/news]", error);
    return NextResponse.json({ error: "News fetch failed" }, { status: 502 });
  }
}
