import { NextResponse } from "next/server";
import { fetchPlayOutcomeStats, fetchRecentPlayOutcomes } from "@/lib/spx-play-outcomes";
import { computeAdaptiveGates } from "@/lib/spx-play-telemetry";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const [stats, rows] = await Promise.all([
      fetchPlayOutcomeStats(),
      fetchRecentPlayOutcomes(limit),
    ]);
    const adaptive = computeAdaptiveGates(stats);
    return NextResponse.json({ stats, adaptive, rows });
  } catch (error) {
    console.error("[market/spx/outcomes]", error);
    return NextResponse.json(
      { stats: null, adaptive: null, rows: [], error: "Failed to load outcomes" },
      { status: 502 }
    );
  }
}
