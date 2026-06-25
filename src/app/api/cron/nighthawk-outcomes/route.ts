import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { resolvePendingNighthawkOutcomes } from "@/lib/nighthawk/play-outcomes";
import { inEtWindow } from "@/lib/nighthawk/et-window";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function inOutcomeWindow(force: boolean): boolean {
  if (force) return true;
  // DST-aware window (America/New_York). The Railway cron now fires at both 20:30 and
  // 21:30 UTC so 16:30 ET is hit in EDT and EST; this guard self-skips the off-band fire.
  return inEtWindow({
    targetHour: Number(process.env.NIGHTHAWK_OUTCOMES_HOUR_ET ?? "16"),
    targetMinute: Number(process.env.NIGHTHAWK_OUTCOMES_MINUTE_ET ?? "30"),
    catchupMin: Number(process.env.NIGHTHAWK_OUTCOMES_CATCHUP_MIN ?? "90"),
  });
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!inOutcomeWindow(force)) {
    const payload = {
      ok: false,
      skipped: true,
      reason: "Outside outcome window (4:30 PM ET) — use ?force=1 to override",
    };
    await logCronRun("nighthawk-outcomes", started, payload);
    return NextResponse.json(payload);
  }

  try {
    // Guard against a non-numeric ?days override: Number("abc") → NaN, which would bind to
    // the $1::int SQL param and make Postgres throw "invalid input syntax for type integer".
    // Fall back to the 7-day default for anything non-finite or non-positive.
    const rawDays = Number(req.nextUrl.searchParams.get("days") ?? "7");
    const lookbackDays = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 7;
    const result = await resolvePendingNighthawkOutcomes({ lookbackDays });
    const payload = { ok: true, ...result };
    await logCronRun("nighthawk-outcomes", started, {
      ok: true,
      resolved: result.resolved,
      skipped_count: result.skipped,
      errors: result.errors,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/nighthawk-outcomes]", error);
    await logCronRun("nighthawk-outcomes", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Outcome resolution failed", detail }, { status: 500 });
  }
}
