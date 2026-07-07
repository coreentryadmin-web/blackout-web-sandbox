import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchPlayOutcomeStats, fetchRecentPlayOutcomes } from "@/features/spx/lib/spx-play-outcomes";
import { computeAdaptiveGates } from "@/features/spx/lib/spx-play-telemetry";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const [stats, rows] = await Promise.all([
      fetchPlayOutcomeStats(),
      fetchRecentPlayOutcomes(limit),
    ]);
    const adaptive = computeAdaptiveGates(stats);
    return NextResponse.json(roundFloats({ stats, adaptive, rows }));
  } catch (error) {
    console.error("[market/spx/outcomes]", error);
    return NextResponse.json(
      { stats: null, adaptive: null, rows: [], error: "Failed to load outcomes" },
      { status: 502 }
    );
  }
}
