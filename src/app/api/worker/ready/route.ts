import { NextResponse } from "next/server";
import { isIngestProcess } from "@/lib/process-role";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { getIndexStoreStatus } from "@/lib/ws/polygon-socket";
import { getUwSocketHealth } from "@/lib/ws/uw-socket";
import { uwConfigured } from "@/lib/providers/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness for market-data worker — sockets initialized on this process. */
export async function GET() {
  if (!isIngestProcess()) {
    return NextResponse.json(
      { ok: false, reason: "worker_ready_requires_ingest_role" },
      { status: 404 }
    );
  }

  ensureDataSockets();

  const uw = getUwSocketHealth();
  const indices = getIndexStoreStatus();

  const uwOk = !uwConfigured() || (uw.initialized && !uw.auth_failed);
  const indicesOk =
    !uwConfigured() ||
    indices.authenticated ||
    indices.wsState === "OPEN" ||
    indices.wsState === "CONNECTING";

  const ok = uwOk && indicesOk;

  return NextResponse.json(
    {
      ok,
      as_of: new Date().toISOString(),
      unusual_whales: { initialized: uw.initialized, auth_failed: uw.auth_failed },
      polygon_indices: { authenticated: indices.authenticated, ws_state: indices.wsState },
    },
    { status: ok ? 200 : 503 }
  );
}
