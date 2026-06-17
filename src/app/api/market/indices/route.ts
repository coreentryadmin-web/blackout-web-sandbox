import { NextResponse } from "next/server";
import { fetchIndexSnapshots } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";

const SPX = "I:SPX";
const VIX = "I:VIX";

export async function GET() {
  if (!polygonConfigured()) {
    return NextResponse.json({ error: "POLYGON_API_KEY not configured" }, { status: 503 });
  }

  try {
    const snaps = await fetchIndexSnapshots([SPX, VIX]);
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