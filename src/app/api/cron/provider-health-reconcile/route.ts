import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isSpxEngineCronWindow } from "@/features/spx/lib/spx-play-session-guards";
import { logCronRun } from "@/lib/cron-run";
import { syncAdminIncidents } from "@/lib/admin-incidents";
import {
  PROVIDER_HEALTH_CATEGORY,
  runProviderHealthReconcile,
} from "@/lib/provider-health-reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Provider API health reconcile — rolls up api_telemetry_events failures and rate limits
 * into admin incidents (same pattern as data-integrity). Runs during RTH; cheap no-op off-hours.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isSpxEngineCronWindow()) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside RTH window (7:00–16:15 ET weekdays)",
    };
    await logCronRun("provider-health-reconcile", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const windowMin = Number(process.env.PROVIDER_HEALTH_WINDOW_MIN ?? "10");
    const { rollups, issues } = await runProviderHealthReconcile(windowMin);

    const incidentsEnabled = process.env.PROVIDER_HEALTH_INCIDENTS !== "0";
    if (incidentsEnabled) {
      await syncAdminIncidents(issues, {
        resolveScope: (cat) => cat.startsWith(PROVIDER_HEALTH_CATEGORY),
      });
    }

    const payload = {
      ok: true,
      window_min: windowMin,
      providers_flagged: rollups.length,
      incidents: issues.length,
      incidents_synced: incidentsEnabled,
      issues: issues.map((i) => ({ severity: i.severity, title: i.title, detail: i.detail })),
    };
    await logCronRun("provider-health-reconcile", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[provider-health-reconcile]", detail);
    await logCronRun("provider-health-reconcile", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Provider health reconcile failed" }, { status: 500 });
  }
}
