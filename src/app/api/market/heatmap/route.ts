import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchMarketMovers, fetchSectorPerformance } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";
import { serverCache, TTL } from "@/lib/server-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!polygonConfigured()) {
    return NextResponse.json(
      { error: "POLYGON_API_KEY not configured", sectors: [], movers: [], as_of: new Date().toISOString() },
      { status: 503 }
    );
  }

  try {
    const [sectors, movers] = await Promise.all([
      serverCache("heatmap:sectors", TTL.MARKET_SNAPSHOT, () => fetchSectorPerformance()),
      serverCache("heatmap:movers:20", TTL.MARKET_SNAPSHOT, () => fetchMarketMovers(20)),
    ]);
    return NextResponse.json({
      source: "polygon",
      sectors,
      movers,
      as_of: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[market/heatmap]", error);
    return NextResponse.json({ error: "Heatmap fetch failed" }, { status: 502 });
  }
}
