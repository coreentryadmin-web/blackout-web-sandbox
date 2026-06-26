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
import { etMinutes, etClock } from "@/lib/spx-play-session-time";

/**
 * RTH gate (DST-aware ET, weekdays only) mirroring the market-hours cron routes
 * (e.g. nights-watch-warm / heatmap-warm): 9:30 AM–4:00 PM ET, Mon–Fri. Used to
 * decide whether a `market_hours_only` cron that correctly skipped off-window
 * should be treated as healthy rather than stale.
 */
function inMarketHoursEt(now = new Date()): boolean {
  if (!isWeekdayEt()) return false;
  const mins = etMinutes(now);
  return mins >= etClock(9, 30) && mins <= etClock(16, 0);
}

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
  /**
   * True when this is a `market_hours_only` job that is STALE *right now during RTH* — i.e. the
   * silent-death #90 case (a live-data warmer that should be ticking but isn't). This is the
   * loud, never-invisible signal: the watchdog self-heals/alerts on it and the admin UI paints it
   * red. Off-window staleness is already suppressed upstream, so this is only ever set in-window.
   */
  market_hours_stale: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_duration_ms: number | null;
  last_message: string | null;
  age_min: number | null;
  stale_after_min: number;
  effective_stale_min: number;
  stale_multiplier: number;
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
    /** Count of market-hours jobs that are stale RIGHT NOW during RTH (the #90 blind spot). */
    market_hours_stale: number;
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

function effectiveStaleMinutes(job: CronJobDefinition): { effective: number; multiplier: number } {
  if (job.weekdays_only && !isWeekdayEt()) {
    return { effective: job.stale_after_min * 2.5, multiplier: 2.5 };
  }
  if (job.market_hours_only && !isWeekdayEt()) {
    return { effective: job.stale_after_min * 6, multiplier: 6 };
  }
  return { effective: job.stale_after_min, multiplier: 1 };
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
    const { effective: effMin, multiplier: effMult } = effectiveStaleMinutes(job);
    return {
      key: job.key,
      name: job.name,
      kind: job.kind,
      path: job.path ?? null,
      schedule_label: job.schedule_label,
      description: job.description,
      status: "unknown",
      status_label: "No runs logged",
      market_hours_stale: false,
      last_run_at: null,
      last_status: null,
      last_duration_ms: null,
      last_message: null,
      age_min: null,
      stale_after_min: job.stale_after_min,
      effective_stale_min: Math.round(effMin),
      stale_multiplier: effMult,
      runs_24h: counts,
    };
  }

  const ageMin = (Date.now() - new Date(last.started_at).getTime()) / 60_000;
  const { effective: staleThreshold, multiplier: staleMultiplier } = effectiveStaleMinutes(job);

  // Market-hours-only crons (flow-ingest, spx-evaluate, nights-watch-warm, gex-alerts, …)
  // intentionally skip off-window. Once the market is closed they CANNOT log a fresh run,
  // so age inevitably exceeds the threshold — flagging them STALE is a false alarm. While
  // off-window, suppress the stale flag as long as the last logged run was a legitimate skip
  // or success (a "failed" last run is still surfaced below regardless of window).
  const offWindow = Boolean(job.market_hours_only) && !inMarketHoursEt();
  const suppressStaleOffWindow =
    offWindow && (last.status === "skipped" || last.status === "ok");

  let status: CronJobHealthStatus = "healthy";
  let statusLabel = "OK";

  if (last.status === "failed") {
    status = "failed";
    statusLabel = "Last run failed";
  } else if (suppressStaleOffWindow) {
    status = "healthy";
    statusLabel = last.status === "skipped" ? "Idle (market closed)" : "OK (market closed)";
  } else if (ageMin > staleThreshold) {
    status = "stale";
    statusLabel = `No run in ${Math.round(ageMin)}m (limit ${Math.round(staleThreshold)}m${staleMultiplier > 1 ? ` · ${staleMultiplier}× weekend` : ""})`;
  } else if (last.status === "skipped") {
    status = "warning";
    statusLabel = "Last run skipped";
  } else if (counts.failed > 0 && counts.ok === 0) {
    status = "warning";
    statusLabel = "Failures in last 24h";
  }

  // Flag a market-hours warmer that is stale WHILE the market is open — the #90 silent-death case.
  // `offWindow` is false here means we're in RTH, so a "stale" status is a genuine live-data outage.
  const marketHoursStale = Boolean(job.market_hours_only) && !offWindow && status === "stale";

  return {
    key: job.key,
    name: job.name,
    kind: job.kind,
    path: job.path ?? null,
    schedule_label: job.schedule_label,
    description: job.description,
    status,
    status_label: statusLabel,
    market_hours_stale: marketHoursStale,
    last_run_at: last.started_at,
    last_status: last.status,
    last_duration_ms: last.duration_ms,
    last_message: last.message,
    age_min: Math.round(ageMin),
    stale_after_min: job.stale_after_min,
    effective_stale_min: Math.round(staleThreshold),
    stale_multiplier: staleMultiplier,
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
      const hbAgeMin = playHb.age_ms != null ? Math.round(playHb.age_ms / 60_000) : null;
      const { effective: staleThreshold } = effectiveStaleMinutes(job);
      // Off-window the engine correctly idles, so a high cron age is expected — don't let
      // the heartbeat block re-flag a healthy off-hours skip (FIX-1) as stale/warning.
      const offWindow = Boolean(job.market_hours_only) && !inMarketHoursEt();
      const cronStale = !offWindow && health.age_min != null && health.age_min > staleThreshold;

      if (cronStale && hbAgeMin != null) {
        const overrideStatus = playHb.stale ? ("stale" as const) : ("warning" as const);
        return {
          ...health,
          status: overrideStatus,
          // Keep the RTH-stale flag in sync with the heartbeat override: spx-evaluate is a
          // market-hours job, and `cronStale` is only true in-window, so a stale verdict here
          // is a genuine in-RTH outage.
          market_hours_stale: overrideStatus === "stale",
          status_label: playHb.stale
            ? `Cron stale · engine tick ${hbAgeMin}m ago (stale)`
            : `Cron stale · engine tick ${hbAgeMin}m ago (heartbeat only)`,
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

      // A non-terminal job (anything not published/failed) whose updated_at is older than this is
      // STUCK — with the fire-and-forget builder a healthy build checkpoints every stage within
      // minutes, so >60m without progress and without publishing means the background build died
      // silently (host kill, OOM, hung Claude call). Escalate to `stale` so the watchdog alerts the
      // same night instead of waiting out the 4h registry ceiling. (#77 hardening D, item 10)
      const STUCK_JOB_MIN = 60;
      const nonTerminal = latestNhJob.status !== "published" && latestNhJob.status !== "failed";
      const stuck = nonTerminal && ageMin != null && ageMin > STUCK_JOB_MIN;

      // Is the published edition RECENT? Heal a stale handshake only when the writer's real target was
      // refreshed within the registry staleness window — a published edition from days ago with no
      // fresh attempt is itself stale and must NOT be painted healthy.
      const { effective: nhStaleMin } = effectiveStaleMinutes(job);
      const publishFresh = ageMin != null && ageMin <= nhStaleMin;

      if (latestNhJob.status === "failed") {
        status = "failed";
        statusLabel = `Job failed: ${latestNhJob.error ?? latestNhJob.current_stage ?? "unknown"}`;
      } else if (latestNhJob.status === "published") {
        // The edition PUBLISHED — when its row is fresh, the writer's actual target (nighthawk_editions)
        // is current, so the run is HEALTHY regardless of what the last cron_job_runs handshake row says.
        // Before the fire-and-forget cron (#77 hardening D) the route AWAITED the multi-minute build and
        // lost the hit-cron 60s handshake / logged timeout-budget checkpoints as ok:false, leaving STALE
        // `failed` rows in cron_job_runs. Healing only `unknown`/`stale` (not `failed`) let such a stale
        // `failed` row keep the run painted "failed" while the label read "Published <date>" — a
        // contradictory state the data-integrity writer check then surfaced as a false flag. The
        // published nighthawk_job is the authoritative outcome of THIS job: a FRESH published edition
        // heals to healthy; a STALE one (no fresh build) stays stale so the watchdog still alerts.
        status = publishFresh ? "healthy" : "stale";
        statusLabel = publishFresh
          ? `Published ${latestNhJob.edition_for}`
          : `Last published ${latestNhJob.edition_for} (${ageMin}m ago > ${Math.round(nhStaleMin)}m) — no fresh build`;
      } else if (stuck) {
        status = "stale";
        statusLabel = `Stuck ${ageMin}m at ${latestNhJob.current_stage ?? latestNhJob.status} (no publish, no progress)`;
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
    market_hours_stale: jobs.filter((j) => j.market_hours_stale).length,
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
        "No runs in cron_job_runs yet. HTTP crons must call blackout-web with the header 'Authorization: Bearer $CRON_SECRET' after this deploy. Railway Ready/Running status is separate from this dashboard.";
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
