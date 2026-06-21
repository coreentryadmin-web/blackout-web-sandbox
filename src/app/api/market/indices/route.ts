import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchIndexSnapshots } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";
import { serverCache, TTL } from "@/lib/server-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SPX = "I:SPX";
const VIX = "I:VIX";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!polygonConfigured()) {
    return NextResponse.json({ error: "POLYGON_API_KEY not configured" }, { status: 503 });
  }

  try {
    const snaps = await serverCache("indices:spx-vix", TTL.MARKET_SNAPSHOT, () => fetchIndexSnapshots([SPX, VIX]));
    const spx = snaps[SPX];
    const vix = snaps[VIX];

    if (!spx && !vix) {
      return NextResponse.json(
        { error: "No index data returned — check Indices Advanced plan on Massive" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      source: "polygon",
      as_of: new Date().toISOString(),
      spx,
      vix,
    });
  } catch (error) {
    console.error("[market/indices]", error);
    return NextResponse.json({ error: "Index fetch failed" }, { status: 502 });
  }
}
