import { CRON_JOBS, type CronJobDefinition } from "@/lib/cron-registry";
import {
  dbConfigured,
  fetchCronJobLastRuns,
  fetchCronJobRecentRuns,
  fetchCronJobRunCount,
  fetchLatestNighthawkJob,
  type CronJobRunRow,
} from "@/lib/db";
import { loadPlayEngineHeartbeat } from "@/lib/play-engine-heartbeat";
import { isWeekdayEt } from "@/lib/nighthawk/session";

export type CronJobHealthStatus = "healthy" | "warning" | "stale" | "failed" | "unknown";

export type CronJobHealth = {
  key: string;
  name: string;
  kind: CronJobDefinition["kind"];
  path: string | null;
  schedule_label: string;
  description: string;
  status: CronJobHealthStatus;
  status_label: string;
  last_run_at: string | null;
  last_status: string | null;
  last_duration_ms: number | null;
  last_message: string | null;
  age_min: number | null;
  stale_after_min: number;
  runs_24h: { ok: number; failed: number; skipped: number };
  meta?: Record<string, unknown>;
};

export type CronHealthPayload = {
  generated_at: string;
  cron_secret_configured: boolean;
  db_configured: boolean;
  logged_runs_total: number;
  diagnostics_note: string | null;
  summary: {
    total: number;
    healthy: number;
    warning: number;
    stale: number;
    failed: number;
    unknown: number;
  };
  jobs: CronJobHealth[];
  recent_events: Array<{
    job_key: string;
    job_name: string;
    status: string;
    started_at: string;
    duration_ms: number | null;
    message: string | null;
  }>;
};

function effectiveStaleMinutes(job: CronJobDefinition): number {
  if (job.weekdays_only && !isWeekdayEt()) {
    return job.stale_after_min * 2.5;
  }
  if (job.market_hours_only && !isWeekdayEt()) {
    return job.stale_after_min * 6;
  }
  return job.stale_after_min;
}

function evaluateJob(
  job: CronJobDefinition,
  last: CronJobRunRow | undefined,
  runs24h: CronJobRunRow[]
): CronJobHealth {
  const counts = { ok: 0, failed: 0, skipped: 0 };
  for (const r of runs24h) {
    if (r.status === "ok") counts.ok += 1;
    else if (r.status === "failed") counts.failed += 1;
    else if (r.status === "skipped") counts.skipped += 1;
  }

  if (!last) {
    return {
      key: job.key,
      name: job.name,
      kind: job.kind,
      path: job.path ?? null,
      schedule_label: job.schedule_label,
      description: job.description,
      status: "unknown",
      status_label: "No runs logged",
      last_run_at: null,
      last_status: null,
      last_duration_ms: null,
      last_message: null,
      age_min: null,
      stale_after_min: job.stale_after_min,
      runs_24h: counts,
    };
  }

  const ageMin = (Date.now() - new Date(last.started_at).getTime()) / 60_000;
  const staleThreshold = effectiveStaleMinutes(job);

  let status: CronJobHealthStatus = "healthy";
  let statusLabel = "OK";

  if (last.status === "failed") {
    status = "failed";
    statusLabel = "Last run failed";
  } else if (ageMin > staleThreshold) {
    status = "stale";
    statusLabel = `No run in ${Math.round(ageMin)}m (limit ${Math.round(staleThreshold)}m)`;
  } else if (last.status === "skipped") {
    status = "warning";
    statusLabel = "Last run skipped";
  } else if (counts.failed > 0 && counts.ok === 0) {
    status = "warning";
    statusLabel = "Failures in last 24h";
  }

  return {
    key: job.key,
    name: job.name,
    kind: job.kind,
    path: job.path ?? null,
    schedule_label: job.schedule_label,
    description: job.description,
    status,
    status_label: statusLabel,
    last_run_at: last.started_at,
    last_status: last.status,
    last_duration_ms: last.duration_ms,
    last_message: last.message,
    age_min: Math.round(ageMin),
    stale_after_min: job.stale_after_min,
    runs_24h: counts,
    meta: last.meta_json ?? undefined,
  };
}

export async function buildCronHealthSnapshot(): Promise<CronHealthPayload> {
  const [lastRuns, recentRuns, latestNhJob] = await Promise.all([
    dbConfigured() ? fetchCronJobLastRuns() : Promise.resolve([]),
    dbConfigured() ? fetchCronJobRecentRuns(48) : Promise.resolve([]),
    dbConfigured() ? fetchLatestNighthawkJob() : Promise.resolve(null),
  ]);

  const lastByKey = Object.fromEntries(lastRuns.map((r) => [r.job_key, r]));
  const since24h = Date.now() - 24 * 60 * 60_000;
  const runs24hByKey = new Map<string, CronJobRunRow[]>();
  for (const r of recentRuns) {
    if (new Date(r.started_at).getTime() < since24h) continue;
    const list = runs24hByKey.get(r.job_key) ?? [];
    list.push(r);
    runs24hByKey.set(r.job_key, list);
  }

  const playHb = await loadPlayEngineHeartbeat();
  const jobs = CRON_JOBS.map((job) => {
    const health = evaluateJob(job, lastByKey[job.key], runs24hByKey.get(job.key) ?? []);

    if (job.key === "spx-evaluate" && playHb.last_tick_at) {
      const cronAge = health.age_min;
      const hbAgeMin = playHb.age_ms != null ? Math.round(playHb.age_ms / 60_000) : null;
      if ((cronAge == null || cronAge > 20) && hbAgeMin != null && hbAgeMin <= 15) {
        return {
          ...health,
          status: playHb.stale ? ("warning" as const) : ("healthy" as const),
          status_label: playHb.stale
            ? `Cron quiet · engine tick ${hbAgeMin}m ago (stale)`
            : `Engine tick ${hbAgeMin}m ago via ${playHb.last_source ?? "?"}`,
          meta: {
            ...(health.meta ?? {}),
            play_engine_heartbeat: playHb,
          },
        };
      }
    }

    if (job.key === "nighthawk-playbook" && latestNhJob) {
      const updatedAt = latestNhJob.updated_at;
      const ageMin =
        updatedAt != null
          ? Math.round((Date.now() - new Date(updatedAt).getTime()) / 60_000)
          : null;
      let status = health.status;
      let statusLabel = health.status_label;

      if (latestNhJob.status === "failed") {
        status = "failed";
        statusLabel = `Job failed: ${latestNhJob.error ?? latestNhJob.current_stage ?? "unknown"}`;
      } else if (latestNhJob.status === "published") {
        status = health.status === "unknown" || health.status === "stale" ? "healthy" : health.status;
        statusLabel = `Published ${latestNhJob.edition_for}`;
      } else if (health.status === "unknown") {
        status = "warning";
        statusLabel = `${latestNhJob.status}${latestNhJob.current_stage ? ` · ${latestNhJob.current_stage}` : ""}`;
      }

      return {
        ...health,
        status,
        status_label: statusLabel,
        last_run_at: health.last_run_at ?? updatedAt,
        age_min: health.age_min ?? ageMin,
        meta: {
          ...(health.meta ?? {}),
          nighthawk_job: {
            edition_for: latestNhJob.edition_for,
            status: latestNhJob.status,
            current_stage: latestNhJob.current_stage,
            error: latestNhJob.error,
            updated_at: latestNhJob.updated_at,
            published_at: latestNhJob.published_at,
          },
          source: health.last_run_at ? "cron_log+nighthawk_job" : "nighthawk_job_only",
        },
      };
    }

    return health;
  });

  const summary = {
    total: jobs.length,
    healthy: jobs.filter((j) => j.status === "healthy").length,
    warning: jobs.filter((j) => j.status === "warning").length,
    stale: jobs.filter((j) => j.status === "stale").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    unknown: jobs.filter((j) => j.status === "unknown").length,
  };

  const jobNameByKey = Object.fromEntries(CRON_JOBS.map((j) => [j.key, j.name]));
  const loggedRunsTotal = dbConfigured() ? await fetchCronJobRunCount() : 0;

  let diagnosticsNote: string | null = null;
  if (loggedRunsTotal === 0) {
    if (!dbConfigured()) {
      diagnosticsNote =
        "DATABASE_URL is not set on blackout-web — cron runs cannot be logged to Postgres.";
    } else if (!process.env.CRON_SECRET?.trim()) {
      diagnosticsNote =
        "CRON_SECRET is not set on blackout-web — HTTP cron routes return 401 and never log a run.";
    } else {
      diagnosticsNote =
        "No runs in cron_job_runs yet. HTTP crons must curl blackout-web with ?secret=CRON_SECRET after this deploy. Railway Ready/Running status is separate from this dashboard.";
    }
  }

  return {
    generated_at: new Date().toISOString(),
    cron_secret_configured: Boolean(process.env.CRON_SECRET?.trim()),
    db_configured: dbConfigured(),
    logged_runs_total: loggedRunsTotal,
    diagnostics_note: diagnosticsNote,
    summary,
    jobs,
    recent_events: recentRuns.slice(0, 24).map((r) => ({
      job_key: r.job_key,
      job_name: jobNameByKey[r.job_key] ?? r.job_key,
      status: r.status,
      started_at: r.started_at,
      duration_ms: r.duration_ms,
      message: r.message,
    })),
  };
}
