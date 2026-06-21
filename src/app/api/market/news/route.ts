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

  try {
    const articles = await serverCache("news:benzinga:15", TTL.NEWS, () => fetchBenzingaNews(15));
    return NextResponse.json({ source: "benzinga", articles });
  } catch (error) {
    console.error("[market/news]", error);
    return NextResponse.json({ error: "News fetch failed" }, { status: 502 });
  }
}
