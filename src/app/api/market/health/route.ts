import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { buildMarketHealthSnapshot } from "@/lib/market-health";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Admin-only full ops snapshot — public callers get minimal liveness only. */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) {
    return NextResponse.json(
      { ok: true, as_of: new Date().toISOString() },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const snapshot = await buildMarketHealthSnapshot();
  ensureDataSockets();
  return NextResponse.json(snapshot, {
    status: snapshot.ok ? 200 : 503,
  });
}
