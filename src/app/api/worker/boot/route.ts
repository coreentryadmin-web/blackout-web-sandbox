import { NextResponse } from "next/server";
import { isIngestProcess } from "@/lib/process-role";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Eager socket boot — invoked by deploy/market-worker.mjs on worker startup. */
export async function GET() {
  if (!isIngestProcess()) {
    return NextResponse.json(
      { ok: false, reason: "worker_boot_requires_ingest_role" },
      { status: 404 }
    );
  }

  ensureDataSockets();

  return NextResponse.json({
    ok: true,
    booted: true,
    as_of: new Date().toISOString(),
  });
}
