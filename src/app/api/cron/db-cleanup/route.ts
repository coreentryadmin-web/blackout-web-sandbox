import { NextRequest, NextResponse } from "next/server";
import { dbQuery, requireDatabaseInProduction } from "@/lib/db";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isAllowedCleanupTarget, cleanupRetentionDays } from "@/lib/db-cleanup-targets";
import { sumCleanupDeletes } from "@/lib/db-cleanup-sum";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    const { tables: pruneCounts, errors: pruneErrors } = await runCleanup();
    const totalDeleted = sumCleanupDeletes(pruneCounts);
    // BIE daily tick (best-effort, never fails the cleanup): ingest fresh platform
    // knowledge (docs/FINDINGS/latest edition — hash-deduped, embeds only when
    // VOYAGE_API_KEY is set) and persist the engine's self-evaluation report.
    const bie = await import("@/lib/bie/knowledge")
      .then((m) => m.ingestBieKnowledge())
      .catch(() => ({ stored: -1 }));
    const selfEval = await import("@/lib/bie/report")
      .then((m) => m.runBieDailySelfEval())
      .catch(() => null);
    const calibration = await import("@/lib/bie/calibration")
      .then((m) => m.runBieCalibration(14))
      .catch(() => null);
    const discovery = await import("@/lib/bie/discovery")
      .then((m) => m.runBieDiscovery())
      .catch(() => null);
    const tables: Record<string, unknown> = {
      ...pruneCounts,
      bie_knowledge_stored: bie.stored,
      bie_self_eval: selfEval ? "ok" : "skipped",
      bie_calibration: calibration
        ? `${calibration.graded_plays} graded / ${calibration.recommendations.length} recs`
        : "skipped",
      bie_discovery: discovery
        ? `${discovery.patterns} call patterns analyzed`
        : "skipped",
    };
    const ok = pruneErrors.length === 0;
    const payload = {
      ok,
      total_deleted: totalDeleted,
      tables,
      ...(pruneErrors.length > 0 ? { errors: pruneErrors } : {}),
    };
    await logCronRun("db-cleanup", started, payload);
    return NextResponse.json(payload, { status: ok ? 200 : 500 });
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

type CleanupRunResult = {
  tables: Record<string, number>;
  errors: { table: string; error: string }[];
};

async function runCleanup(): Promise<CleanupRunResult> {
  // Generous, env-configurable retention for high-write outcome tables. Default 365d keeps a
  // full year of resolved history for admin rollups / Largo analytics; hard floor is 90d.
  const spxOutcomeDays = cleanupRetentionDays(process.env.SPX_OUTCOMES_RETENTION_DAYS, 365);
  const nighthawkOutcomeDays = cleanupRetentionDays(
    process.env.NIGHTHAWK_OUTCOMES_RETENTION_DAYS,
    365,
  );

  const tasks: { key: string; run: () => Promise<number> }[] = [
    // api_telemetry_events: very high volume (~30k rows/day) — keep 7 days
    // NOTE: this table's timestamp column is "at", not "created_at"
    { key: "api_telemetry_events", run: () => deleteOlderThan("api_telemetry_events", "at", 7) },

    // flow_alerts: keep 60 days
    // Hard floor is 30d (Night Hawk avg-premium scorer uses 30-day rolling window).
    // 60d gives safety margin + covers user lookback and Largo historical queries.
    { key: "flow_alerts", run: () => deleteOlderThan("flow_alerts", "inserted_at", 60) },

    // cron_job_runs: keep 30 days of run history
    { key: "cron_job_runs", run: () => deleteOlderThan("cron_job_runs", "started_at", 30) },

    // spx_signal_log: evaluator fires every 30-60s during RTH — keep 90 days
    { key: "spx_signal_log", run: () => deleteOlderThan("spx_signal_log", "created_at", 90) },

    // nighthawk_dossiers_staging: temp staging — never queried after nightly build completes
    {
      key: "nighthawk_dossiers_staging",
      run: () => deleteOlderThan("nighthawk_dossiers_staging", "created_at", 2),
    },

    // nighthawk_job_log: nightly runs — keep 60 days
    { key: "nighthawk_job_log", run: () => deleteOlderThan("nighthawk_job_log", "created_at", 60) },

    // admin_audit_log: compliance — keep 90 days
    { key: "admin_audit_log", run: () => deleteOlderThan("admin_audit_log", "created_at", 90) },

    // spx_play_outcomes: high-write trade-outcome ledger. Prune CLOSED rows only
    // (open rows have closed_at IS NULL + 'outcome <> open' guard). Default 365d, >=90d floor.
    {
      key: "spx_play_outcomes",
      run: () => deleteOlderThan("spx_play_outcomes", "closed_at", spxOutcomeDays),
    },

    // nighthawk_play_outcomes: high-write outcome ledger. Prune RESOLVED rows only
    // (pending/open excluded by status guard). Default 365d, >=90d floor.
    {
      key: "nighthawk_play_outcomes",
      run: () => deleteOlderThan("nighthawk_play_outcomes", "created_at", nighthawkOutcomeDays),
    },

    // spx_signal_observations: every-5-min RTH snapshots — keep 180 days for analytics
    {
      key: "spx_signal_observations",
      run: () => deleteOlderThan("spx_signal_observations", "observed_at", 180),
    },

    // spx_signal_weight_reports: one row per nightly run — keep 365 days
    {
      key: "spx_signal_weight_reports",
      run: () => deleteOlderThan("spx_signal_weight_reports", "computed_at", 365),
    },

    // market_regime: every-few-min RTH snapshots; only the latest row is read for "current
    // regime". Previously unbounded — keep 90 days for trend analytics.
    { key: "market_regime", run: () => deleteOlderThan("market_regime", "captured_at", 90) },

    // flow_anomalies: every-5-min RTH detections (recent ones surfaced in UI). Previously
    // unbounded — keep 90 days.
    { key: "flow_anomalies", run: () => deleteOlderThan("flow_anomalies", "detected_at", 90) },

    // coaching_alerts: every-10-min RTH rows (UI reads only the last ~30 min). Previously
    // unbounded — keep 90 days.
    { key: "coaching_alerts", run: () => deleteOlderThan("coaching_alerts", "generated_at", 90) },

    // SPX shadow + engine telemetry — high write volume during RTH.
    {
      key: "spx_confluence_shadow_observations",
      run: () => deleteOlderThan("spx_confluence_shadow_observations", "observed_at", 180),
    },
    {
      key: "spx_engine_snapshots",
      run: () => deleteOlderThan("spx_engine_snapshots", "observed_at", 90),
    },
    {
      key: "spx_playbook_shadow_observations",
      run: () => deleteOlderThan("spx_playbook_shadow_observations", "observed_at", 180),
    },
    {
      key: "spx_playbook_instance_events",
      run: () => deleteOlderThan("spx_playbook_instance_events", "observed_at", 180),
    },
    {
      key: "spx_playbook_instances",
      run: () => deleteOlderThan("spx_playbook_instances", "updated_at", 365),
    },
    { key: "lotto_plays", run: () => deleteOlderThan("lotto_plays", "created_at", 365) },

    // vector_wall_history: durable mirror of the Redis wall rail — one upsert per 15s bucket
    // during RTH. Only ~90 days are ever replayed, so prune older sessions by updated_at.
    {
      key: "vector_wall_history",
      run: () => deleteOlderThan("vector_wall_history", "updated_at", 90),
    },
  ];

  // allSettled: one table's transient timeout must not abort the rest of the nightly prune.
  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const tables: Record<string, number> = {};
  const errors: { table: string; error: string }[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const { key } = tasks[i];
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      tables[key] = outcome.value;
      continue;
    }
    tables[key] = 0;
    const error =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    errors.push({ table: key, error });
    console.error(`[db-cleanup] ${key} prune failed:`, error);
  }

  return { tables, errors };
}
