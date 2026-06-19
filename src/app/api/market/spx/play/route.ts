import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { readSpxPlaySnapshot } from "@/lib/spx-evaluator";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  try {
    const { merged } = await loadMergedSpxDesk();
    const technicals = await buildPlayTechnicals(merged.price, {
      vwap: merged.vwap,
      pdh: merged.pdh,
      pdl: merged.pdl,
      hod: merged.hod,
      lod: merged.lod,
    });
    const play = await readSpxPlaySnapshot(merged, technicals);

    return NextResponse.json(play, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/play]", error);
    return NextResponse.json(
      { available: false, action: "SCANNING", error: "Play engine failed" },
      { status: 502 }
    );
  }
}
