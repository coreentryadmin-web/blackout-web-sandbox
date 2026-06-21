import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { fetchLottoPlaysForDate } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { evaluateSpxLotto } from "@/lib/spx-lotto-engine";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";
import { todayEtYmd } from "@/lib/providers/spx-session";

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

    const lotto = await evaluateSpxLotto(merged, technicals);
    const history = await fetchLottoPlaysForDate(todayEtYmd());

    return NextResponse.json(
      {
        available: true,
        as_of: merged.polled_at ?? new Date().toISOString(),
        lotto,
        history,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("[market/lotto/today]", error);
    return NextResponse.json(
      { available: false, lotto: null, error: "Lotto engine failed" },
      { status: 502 }
    );
  }
}
