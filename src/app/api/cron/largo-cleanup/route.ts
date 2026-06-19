import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { largoSessionRetentionDays, purgeStaleLargoSessions } from "@/lib/largo/largo-store";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const dynamic = "force-dynamic";

/** Weekly cleanup — delete Largo sessions inactive for 7+ days (default). */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const daysParam = req.nextUrl.searchParams.get("days");
  const retentionDays = daysParam ? Number(daysParam) : largoSessionRetentionDays();
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    return NextResponse.json({ error: "Invalid days parameter" }, { status: 400 });
  }

  try {
    const result = await purgeStaleLargoSessions(retentionDays);
    await logCronRun("largo-cleanup", started, { ok: true, ...result });
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/largo-cleanup]", error);
    await logCronRun("largo-cleanup", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Largo cleanup failed", detail }, { status: 500 });
  }
}
