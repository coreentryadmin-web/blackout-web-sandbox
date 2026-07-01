import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSpxDesk } from "@/lib/spx-desk-loader";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  try {
    // loadSpxDesk() is THE single cache lane for buildSpxDesk() — shared with
    // /api/market/spx/play and /api/admin/spx/dashboard (via loadMergedSpxDesk) so the
    // member dashboard and the trade-alert panel can never diverge on a race between two
    // independently-keyed caches. Do not call withServerCache/buildSpxDesk directly here.
    const desk = await loadSpxDesk();
    // ISSUE-29: Do NOT overwrite polled_at with the HTTP response time — that hides
    // how stale the cached data is. Pass desk.polled_at if set, otherwise desk.as_of.
    return NextResponse.json(
      { ...desk, polled_at: desk.polled_at ?? desk.as_of },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("[market/spx/desk]", error);
    return NextResponse.json({ available: false, error: "Desk build failed" }, { status: 502 });
  }
}
