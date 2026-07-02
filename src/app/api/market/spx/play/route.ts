import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { readSpxPlaySnapshot } from "@/lib/spx-evaluator";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

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

    return NextResponse.json(roundFloats(play), {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/play]", error);
    // Return 200+degraded so a transient Massive blip (R-16) gives the client a "scanning"
    // state instead of a 502 network error that clears the play panel entirely.
    return NextResponse.json(
      { available: false, action: "SCANNING", degraded: true },
      {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      }
    );
  }
}
