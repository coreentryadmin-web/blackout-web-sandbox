// Cron: pre-warm general platform caches available 24/7.
// Schedule: every 5 minutes, 24 hours/day.
//
// THE POINT: The platform bootstrap bundle (loaded by many admin/member pages outside market
// hours) is UW-bound (~2–5s cold). This cron keeps the bootstrap cache warm so off-hours
// page loads (night Hawk edge, early BIE lookups) don't block on expensive rebuilds.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { loadBootstrapBundle } from "@/features/spx/lib/spx-desk-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bootstrapResult = await Promise.allSettled([loadBootstrapBundle()]);

  const bootstrapOk = bootstrapResult[0].status === "fulfilled";

  if (!bootstrapOk) {
    console.warn(
      "[cron/platform-warm] loadBootstrapBundle failed:",
      bootstrapResult[0].status === "rejected" ? bootstrapResult[0].reason : "unknown"
    );
  }

  await logCronRun("platform-warm", started, {
    ok: bootstrapOk,
    bootstrap: bootstrapOk,
    ...(bootstrapOk ? {} : { error: "bootstrap warm failed" }),
  });

  return NextResponse.json({
    ok: bootstrapOk,
    bootstrap: bootstrapOk,
  });
}
