import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Minimal deploy liveness — Railway healthcheck; no auth, no DB migrations. */
export async function GET() {
  const as_of = new Date().toISOString();

  if (!dbConfigured()) {
    return NextResponse.json({ ok: true, as_of, db: "skipped" });
  }

  // Readiness is checked elsewhere; liveness must not fail deploy when Postgres is slow/unreachable.
  return NextResponse.json({ ok: true, as_of, db: "configured" });
}
