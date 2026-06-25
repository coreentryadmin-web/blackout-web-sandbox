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

  // buildMarketHealthSnapshot fans out to DB-backed reads (getPlayEngineHealth →
  // loadOpenPlay/loadPlaySessionMeta) that are unguarded and can reject on a transient
  // Postgres failure. Catch it so this admin ops endpoint returns a clean 502 rather than
  // an unhandled 500 (the health view should degrade, not crash, when a dependency is down).
  let snapshot;
  try {
    snapshot = await buildMarketHealthSnapshot();
  } catch (error) {
    console.error("[market/health]", error);
    return NextResponse.json({ ok: false, error: "Health check failed" }, { status: 502 });
  }
  ensureDataSockets();
  return NextResponse.json(snapshot, {
    status: snapshot.ok ? 200 : 503,
  });
}
