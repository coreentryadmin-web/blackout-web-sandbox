import { NextResponse } from "next/server";
import { pingDatabase, dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Readiness probe — checks DB connectivity. Use for Railway deploy gates, not liveness. */
export async function GET() {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: true, db: "skipped" });
  }
  const { ok, error, mode } = await pingDatabase();
  if (!ok) {
    return NextResponse.json({ ok: false, db: "unreachable", error }, { status: 503 });
  }
  return NextResponse.json({ ok: true, db: "connected", mode });
}
