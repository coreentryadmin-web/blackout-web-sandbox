import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { deskCacheTtlMs } from "@/lib/providers/config";
import { buildSpxDesk } from "@/lib/providers/spx-desk";
import { withServerCache } from "@/lib/server-cache";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  try {
    // Serve stale-while-revalidate so the user never waits for a cold Massive chain
    // fetch (can take 20s+). The background refresh updates the cache within the next
    // poll cycle; the slightly-stale snapshot is orders-of-magnitude better than a hang.
    const desk = await withServerCache("spx-desk", deskCacheTtlMs(), buildSpxDesk, {
      staleWhileRevalidate: true,
    });
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
