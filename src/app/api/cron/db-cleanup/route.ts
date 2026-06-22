import { NextRequest, NextResponse } from "next/server";
import { dbQuery, requireDatabaseInProduction } from "@/lib/db";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const dynamic = "force-dynamic";

/**
 * Nightly DB cleanup — prunes high-volume tables to prevent unbounded growth.
 * Retention windows are conservative: analytics tables kept longer, telemetry pruned fast.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const results = await runCleanup();
    const totalDeleted = Object.values(results).reduce((s, n) => s + n, 0);
    const payload = { ok: true, total_deleted: totalDeleted, tables: results };
    await logCronRun("db-cleanup", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/db-cleanup]", error);
    await logCronRun("db-cleanup", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "DB cleanup failed", detail }, { status: 500 });
  }
}

async function deleteOlderThan(table: string, column: string, days: number): Promise<number> {
  const res = await dbQuery<{ count: string }>(
    `DELETE FROM ${table} WHERE ${column} < NOW() - INTERVAL '${days} days' RETURNING 1`
  );
  return res.rowCount ?? 0;
}

async function runCleanup(): Promise<Record<string, number>> {
  const [
    apiTelemetry,
    flowAlerts,
    cronRuns,
    spxSignalLog,
    nighthawkDossiersStaging,
    nighthawkJobLog,
    adminAuditLog,
  ] = await Promise.all([
    // api_telemetry_events: very high volume (~30k rows/day) — keep 7 days
    // NOTE: this table's timestamp column is "at", not "created_at"
    deleteOlderThan("api_telemetry_events", "at", 7),

    // flow_alerts: keep 60 days
    // Hard floor is 30d (Night Hawk avg-premium scorer uses 30-day rolling window).
    // 60d gives safety margin + covers user lookback and Largo historical queries.
    deleteOlderThan("flow_alerts", "inserted_at", 60),

    // cron_job_runs: keep 30 days of run history
    deleteOlderThan("cron_job_runs", "started_at", 30),

    // spx_signal_log: evaluator fires every 30-60s during RTH — keep 90 days
    deleteOlderThan("spx_signal_log", "created_at", 90),

    // nighthawk_dossiers_staging: temp staging — never queried after nightly build completes
    deleteOlderThan("nighthawk_dossiers_staging", "created_at", 2),

    // nighthawk_job_log: nightly runs — keep 60 days
    deleteOlderThan("nighthawk_job_log", "created_at", 60),

    // admin_audit_log: compliance — keep 90 days
    deleteOlderThan("admin_audit_log", "created_at", 90),
  ]);

  return {
    api_telemetry_events: apiTelemetry,
    flow_alerts: flowAlerts,
    cron_job_runs: cronRuns,
    spx_signal_log: spxSignalLog,
    nighthawk_dossiers_staging: nighthawkDossiersStaging,
    nighthawk_job_log: nighthawkJobLog,
    admin_audit_log: adminAuditLog,
  };
}
