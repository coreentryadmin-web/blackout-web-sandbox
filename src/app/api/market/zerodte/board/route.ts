// 0DTE Command board — the member-facing read of the ALWAYS-ON scanner (see
// src/lib/platform/zerodte-service.ts). A standalone product: the page shows ONLY
// the hunt — fresh single-name 0DTE finds and the graded session ledger.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import { requireZeroDteCommandApi } from "@/lib/tool-access-server";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  if (authResult.via === "user") {
    const zeroDteDenied = await requireZeroDteCommandApi();
    if (zeroDteDenied) return zeroDteDenied;
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  ensureDataSockets();
  try {
    const payload = await getZeroDteBoardPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/zerodte/board]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  }
}
