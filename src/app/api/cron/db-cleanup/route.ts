import { NextRequest, NextResponse } from "next/server";
import { dbQuery, requireDatabaseInProduction } from "@/lib/db";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isAllowedCleanupTarget, cleanupRetentionDays } from "@/lib/db-cleanup-targets";

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

// Fixed, code-literal status guards (NOT user input) so we never prune unresolved/open
// rows on outcome tables. Each value is a hardcoded SQL fragment.
const STATUS_GUARDS: Readonly<Record<string, string>> = {
  spx_play_outcomes: "outcome <> 'open'",
  nighthawk_play_outcomes: "outcome NOT IN ('pending', 'open')",
};

// Cap rows deleted per statement so cleanup never takes a long lock on a high-volume
// table. Each batch is its own short-lived statement/lock; the loop yields between batches.
const CLEANUP_BATCH_SIZE = 5000;
const CLEANUP_MAX_BATCHES = 10_000;

async function deleteOlderThan(table: string, column: string, days: number): Promise<number> {
  // Identifiers cannot be parameterized — validate against the allow-list and reject unknowns.
  if (!isAllowedCleanupTarget(table, column)) {
    throw new Error(`Refusing cleanup of unrecognized target: ${table}.${column}`);
  }
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`Invalid retention window (days must be a non-negative integer): ${days}`);
  }
  // Append a fixed status guard for outcome tables so open/pending rows are never pruned.
  const guard = STATUS_GUARDS[table] ? ` AND ${STATUS_GUARDS[table]}` : "";
  // Batched delete by ctid; window parameterized; rowCount on a plain DELETE is the affected count.
  let total = 0;
  try {
    for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
      const res = await dbQuery(
        `DELETE FROM ${table}
           WHERE ctid IN (
             SELECT ctid FROM ${table}
             WHERE ${column} < NOW() - ($1::int || ' days')::interval${guard}
             LIMIT $2
           )`,
        [days, CLEANUP_BATCH_SIZE]
      );
      const deleted = res.rowCount ?? 0;
      total += deleted;
      if (deleted < CLEANUP_BATCH_SIZE) break;
    }
  } catch (err) {
    // A table whose writer hasn't run yet doesn't exist (Postgres 42P01 undefined_table). There's
    // nothing to prune, and one not-yet-created table must NOT fail the whole nightly cleanup
    // (this was failing the run: 'relation "spx_signal_weight_reports" does not exist'). Skip it;
    // it self-heals once the writer creates the table. Re-throw anything else.
    if ((err as { code?: string } | null)?.code === "42P01") {
      console.warn(`[db-cleanup] skipping ${table}: table does not exist yet (no rows to prune)`);
      return 0;
    }
    throw err;
  }
  return total;
}

async function runCleanup(): Promise<Record<string, number>> {
  // Generous, env-configurable retention for high-write outcome tables. Default 365d keeps a
  // full year of resolved history for admin rollups / Largo analytics; hard floor is 90d.
  const spxOutcomeDays = cleanupRetentionDays(process.env.SPX_OUTCOMES_RETENTION_DAYS, 365);
  const nighthawkOutcomeDays = cleanupRetentionDays(
    process.env.NIGHTHAWK_OUTCOMES_RETENTION_DAYS,
    365,
  );

  const [
    apiTelemetry,
    flowAlerts,
    cronRuns,
    spxSignalLog,
    nighthawkDossiersStaging,
    nighthawkJobLog,
    adminAuditLog,
    spxPlayOutcomes,
    nighthawkPlayOutcomes,
    spxSignalObservations,
    spxSignalWeightReports,
    marketRegime,
    flowAnomalies,
    coachingAlerts,
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

    // spx_play_outcomes: high-write trade-outcome ledger. Prune CLOSED rows only
    // (open rows have closed_at IS NULL + 'outcome <> open' guard). Default 365d, >=90d floor.
    deleteOlderThan("spx_play_outcomes", "closed_at", spxOutcomeDays),

    // nighthawk_play_outcomes: high-write outcome ledger. Prune RESOLVED rows only
    // (pending/open excluded by status guard). Default 365d, >=90d floor.
    deleteOlderThan("nighthawk_play_outcomes", "created_at", nighthawkOutcomeDays),

    // spx_signal_observations: every-5-min RTH snapshots — keep 180 days for analytics
    deleteOlderThan("spx_signal_observations", "observed_at", 180),

    // spx_signal_weight_reports: one row per nightly run — keep 365 days
    deleteOlderThan("spx_signal_weight_reports", "computed_at", 365),

    // market_regime: every-few-min RTH snapshots; only the latest row is read for "current
    // regime". Previously unbounded — keep 90 days for trend analytics.
    deleteOlderThan("market_regime", "captured_at", 90),

    // flow_anomalies: every-5-min RTH detections (recent ones surfaced in UI). Previously
    // unbounded — keep 90 days.
    deleteOlderThan("flow_anomalies", "detected_at", 90),

    // coaching_alerts: every-10-min RTH rows (UI reads only the last ~30 min). Previously
    // unbounded — keep 90 days.
    deleteOlderThan("coaching_alerts", "generated_at", 90),
  ]);

  return {
    api_telemetry_events: apiTelemetry,
    flow_alerts: flowAlerts,
    cron_job_runs: cronRuns,
    spx_signal_log: spxSignalLog,
    nighthawk_dossiers_staging: nighthawkDossiersStaging,
    nighthawk_job_log: nighthawkJobLog,
    admin_audit_log: adminAuditLog,
    spx_play_outcomes: spxPlayOutcomes,
    nighthawk_play_outcomes: nighthawkPlayOutcomes,
    spx_signal_observations: spxSignalObservations,
    spx_signal_weight_reports: spxSignalWeightReports,
    market_regime: marketRegime,
    flow_anomalies: flowAnomalies,
    coaching_alerts: coachingAlerts,
  };
}
