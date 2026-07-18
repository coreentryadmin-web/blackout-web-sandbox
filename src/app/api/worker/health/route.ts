import { NextResponse } from "next/server";
import { isIngestProcess } from "@/lib/process-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness for market-data worker containers (no DB ping). */
export async function GET() {
  if (!isIngestProcess()) {
    return NextResponse.json(
      { ok: false, reason: "worker_health_requires_ingest_role" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    role: "ingest",
    as_of: new Date().toISOString(),
  });
}
