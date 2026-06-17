import { NextResponse } from "next/server";
import { fetchMarketMovers, fetchSectorPerformance } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!polygonConfigured()) {
    return NextResponse.json(
      { error: "POLYGON_API_KEY not configured", sectors: [], movers: [], as_of: new Date().toISOString() },
      { status: 503 }
    );
  }

  try {
    const [sectors, movers] = await Promise.all([fetchSectorPerformance(), fetchMarketMovers(20)]);
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
