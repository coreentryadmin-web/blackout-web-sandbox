import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isSpxEngineCronWindow } from "@/lib/spx-play-session-guards";
import { logCronRun } from "@/lib/cron-run";
import { runDataIntegrityChecks } from "@/lib/data-integrity-checks";
import { syncAdminIncidents } from "@/lib/admin-incidents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RTH data-integrity sweep — cross-validates the numbers every tool shows against
 * each other (desk vs heatmap vs quote, SPY/SPX tracking, max-pain scaling, desk
 * internal math, GEX freshness) and AUTO-OPENS admin incidents on any discrepancy.
 *
 * Hit every ~5 min during market hours from the Railway cron service
 * (railway.data-integrity.toml) with CRON_SECRET. Self-skips outside the RTH window
 * and when the market is closed (numbers are legitimately stale then).
 *
 * Incident creation is ON by default (set DATA_INTEGRITY_INCIDENTS=0 to disable the
 * auto-open and run log-only — an emergency off-switch if the bands ever get noisy).
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
    await logCronRun("data-integrity", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const result = await runDataIntegrityChecks();

    // Auto-open/resolve incidents — scoped to the `data-integrity` namespace so this
    // never touches SPX/infra incidents (and the dashboard never resolves ours).
    const incidentsEnabled = process.env.DATA_INTEGRITY_INCIDENTS !== "0";
    if (incidentsEnabled) {
      await syncAdminIncidents(result.issues, {
        resolveScope: (cat) => cat.startsWith("data-integrity"),
      });
    }

    const payload = {
      ok: true,
      market_open: result.marketOpen,
      checks_run: result.checked,
      discrepancies: result.issues.length,
      incidents_synced: incidentsEnabled,
      issues: result.issues.map((i) => ({ severity: i.severity, title: i.title, detail: i.detail })),
    };
    await logCronRun("data-integrity", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[data-integrity]", detail);
    await logCronRun("data-integrity", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Data-integrity sweep failed" }, { status: 500 });
  }
}
