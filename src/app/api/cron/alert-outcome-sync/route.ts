import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction, tryAdvisoryLock, releaseAdvisoryLock } from "@/lib/db";
import { syncAlertAuditOutcomes } from "@/lib/bie/alert-outcome-sync";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALERT_OUTCOME_SYNC_LOCK = "alert-outcome-sync";

/**
 * BIE Stage 4 — grades historical alert_audit_log rows by copying each row's already-computed
 * outcome from its origin table (zerodte_setup_log / nighthawk_play_outcomes /
 * spx_play_outcomes — see src/lib/bie/alert-outcome-sync.ts for the full root-cause writeup
 * and the exact outcome-vocabulary mapping). Grading historical rows, not live-critical, so a
 * low, unscheduled-window frequency is fine — advisory-locked so overlapping fires (e.g. a
 * slow run plus the next scheduled one) never race the same rows.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const acquired = await tryAdvisoryLock(ALERT_OUTCOME_SYNC_LOCK);
  if (!acquired) {
    const payload = { ok: true, skipped: true, reason: "locked" };
    await logCronRun("alert-outcome-sync", started, payload);
    return NextResponse.json(payload);
  }

  try {
    // Guard against a non-numeric override the same way nighthawk-outcomes/largo-cleanup do —
    // Number("abc") is NaN, which would otherwise silently disable the age/limit clamps.
    const rawMinAge = Number(req.nextUrl.searchParams.get("minAgeMinutes") ?? "180");
    const minAgeMinutes = Number.isFinite(rawMinAge) && rawMinAge > 0 ? rawMinAge : 180;
    const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "500");
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 500;

    const result = await syncAlertAuditOutcomes({ minAgeMinutes, limit });
    const payload = { ok: true, ...result };
    await logCronRun("alert-outcome-sync", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/alert-outcome-sync]", error);
    await logCronRun("alert-outcome-sync", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Alert outcome sync failed", detail }, { status: 500 });
  } finally {
    await releaseAdvisoryLock(ALERT_OUTCOME_SYNC_LOCK);
  }
}
