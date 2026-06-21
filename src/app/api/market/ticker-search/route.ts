import { NextRequest, NextResponse } from "next/server";
import { fetchPolygonTickerSearch } from "@/lib/providers/polygon-largo";
import { serverCache, TTL } from "@/lib/server-cache";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q || q.length < 1) {
    return NextResponse.json({ error: "q param required" }, { status: 400 });
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 10), 20);
  const results = await serverCache(
    `search:${q.toLowerCase()}:${limit}`,
    TTL.TICKER_SEARCH,
    () => fetchPolygonTickerSearch(q, limit)
  );
  return NextResponse.json({ results });
}
