import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction, fetchNighthawkJob } from "@/lib/db";
import { buildEveningEdition, serializeBuildError } from "@/lib/nighthawk/edition-builder";
import { isWeekdayEt, etNowParts, nextTradingDayEt, todayEt } from "@/lib/nighthawk/session";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";

const CRON_KEY = "nighthawk-playbook";

export const dynamic = "force-dynamic";
// Raised to the platform max so a single invocation gets as much wall-clock as the host allows for
// the Claude synthesis stage (live finding #77: the build exceeded the old 300s and was hard-killed,
// so no edition published and the failure never reached /api/admin/errors). On the Railway worker
// (`npm run nighthawk:run`) this is advisory — the worker is not function-timeout-bound — but on any
// serverless/edge surface this lifts the ceiling. The internal BUILD_TIME_BUDGET_MS guard below
// ALWAYS checkpoints + returns a resume status BEFORE the host can kill us, so partial progress is
// never lost regardless of the host's true limit.
export const maxDuration = 800;

/**
 * Internal soft deadline for one invocation. The edition builder checkpoints to Postgres after every
 * stage and is resumable, so when we approach this budget we stop awaiting, persist a `resume` status
 * into the cron-run meta, and return 202 — a follow-up invocation (cron re-fire or `?force=1`)
 * continues from the last checkpoint. Kept a margin under maxDuration so we checkpoint gracefully
 * instead of being hard-killed mid-write (which is exactly how #77 went dark). Override via
 * NIGHTHAWK_EDITION_BUDGET_MS for hosts with a different real ceiling.
 */
const BUILD_TIME_BUDGET_MS = (() => {
  const raw = Number(process.env.NIGHTHAWK_EDITION_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 270_000; // ~4.5 min default
})();

/** Sentinel a time-budget race resolves with when the build outlived this invocation's budget. */
const BUILD_TIMED_OUT = Symbol("nighthawk-edition-build-timed-out");

function editionEnabled(): boolean {
  const flag = process.env.NIGHTHAWK_EDITION_ENABLED?.trim();
  return flag !== "0" && flag !== "false";
}

function inEditionWindow(force: boolean): boolean {
  if (force) return true;
  if (!isWeekdayEt()) return false;
  const hour = Number(process.env.NIGHTHAWK_EDITION_HOUR_ET ?? "17");
  const minute = Number(process.env.NIGHTHAWK_EDITION_MINUTE_ET ?? "30");
  const { hour: nowH, minute: nowM } = etNowParts();
  const now = nowH * 60 + nowM;
  const target = hour * 60 + minute;
  const catchup = Number(process.env.NIGHTHAWK_EDITION_CATCHUP_MIN ?? "120");
  return now >= target && now <= target + catchup;
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  if (!editionEnabled()) {
    const payload = { ok: false, skipped: true, reason: "NIGHTHAWK_EDITION_ENABLED=0" };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const statusOnly = req.nextUrl.searchParams.get("status") === "1";
  // Use ET date explicitly so the edition target doesn't flip at UTC midnight.
  const todayInEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const editionFor = nextTradingDayEt(todayInEt);
  const job = await fetchNighthawkJob(editionFor);

  if (statusOnly) {
    return NextResponse.json({
      ok: true,
      edition_for: editionFor,
      job_status: job?.status ?? "none",
      current_stage: job?.current_stage ?? null,
      error: job?.error ?? null,
      staged_candidates: job?.candidates_json?.length ?? 0,
      note: "Long runs execute via `npm run nighthawk:run` (Railway cron worker). This route nudges/resumes within 300s.",
    });
  }

  if (!inEditionWindow(force) && !(job && job.status !== "published")) {
    const payload = {
      ok: false,
      skipped: true,
      reason: "Outside edition window — use ?force=1 to nudge/resume",
      edition_for: editionFor,
      job_status: job?.status ?? "none",
      current_stage: job?.current_stage ?? null,
    };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  try {
    // Race the build against this invocation's soft deadline. The builder checkpoints to Postgres
    // after every stage, so if we hit the budget we stop awaiting and report a `resume` status — the
    // partial work is durable and a follow-up invocation continues from the last checkpoint. This is
    // the fix for #77: previously a build that overran the function timeout was hard-killed by the
    // host, so nothing published AND the failure never surfaced in /api/admin/errors.
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<typeof BUILD_TIMED_OUT>((resolve) => {
      budgetTimer = setTimeout(() => resolve(BUILD_TIMED_OUT), BUILD_TIME_BUDGET_MS);
    });
    const buildPromise = buildEveningEdition({ force });
    // If the budget wins the race, buildPromise keeps running in the background (its stage
    // checkpoints are still useful for the next invocation). Swallow any LATE rejection so it never
    // becomes an unhandledRejection after we have already returned the resume response.
    buildPromise.catch(() => undefined);
    const raced = await Promise.race([buildPromise, budget]);
    if (budgetTimer) clearTimeout(budgetTimer);

    if (raced === BUILD_TIMED_OUT) {
      // Time budget hit. Re-read the job so admin sees exactly which stage we reached; the builder
      // already persisted progress, so the next fire resumes. NOT a failure → 202 + skipped:true so
      // it does not page ops, but the REASON is recorded in the cron-run meta (visible in admin).
      const partial = await fetchNighthawkJob(editionFor).catch(() => null);
      const stage = partial?.current_stage ?? job?.current_stage ?? null;
      const reason = `timeout_budget:${Math.round(BUILD_TIME_BUDGET_MS / 1000)}s — checkpointed at ${stage ?? "unknown"}; re-fire to resume`;
      console.warn("[cron/nighthawk-edition]", reason);
      await logCronRun(CRON_KEY, started, {
        ok: false,
        skipped: true,
        reason,
        status_detail: "resume",
        error: reason,
        edition_for: editionFor,
        job_status: partial?.status ?? job?.status ?? "running",
        current_stage: stage,
      });
      return NextResponse.json(
        {
          ok: false,
          status: "resume",
          reason,
          edition_for: editionFor,
          job_status: partial?.status ?? job?.status ?? "running",
          current_stage: stage,
          note: "Invocation hit its time budget after checkpointing — re-hit this endpoint or run nighthawk:run to resume.",
        },
        { status: 202 }
      );
    }

    const result = raced;
    const status = result.ok ? 200 : result.job_status === "failed" ? 500 : 202;
    // Map run health precisely (verifier note): ok:true -> ok; explicit 'failed' -> failed;
    // ok:false with a non-failed job_status is a healthy mid-pipeline checkpoint (202) -> skipped,
    // NOT a failure (avoids false Discord alerts). undefined job_status with ok:false
    // (e.g. no API keys) keeps ok:false -> failed.
    const inProgress = !result.ok && result.job_status != null && result.job_status !== "failed";
    await logCronRun(CRON_KEY, started, {
      ok: result.ok,
      skipped: inProgress ? true : undefined,
      reason: inProgress ? `checkpoint:${result.current_stage ?? result.job_status}` : undefined,
      error: result.error,
      edition_for: result.edition_for,
      job_status: result.job_status ?? null,
      current_stage: result.current_stage ?? null,
      plays_count: result.plays_count,
      candidates: result.candidates,
      resumed: result.resumed,
    });
    return NextResponse.json(
      {
        ...result,
        note:
          result.job_status === "published"
            ? "Edition complete."
            : "Checkpointed pipeline — re-hit this endpoint or run nighthawk:run to resume.",
      },
      { status }
    );
  } catch (error) {
    const detail = serializeBuildError(error);
    console.error("[cron/nighthawk-edition]", error);
    // Record the REAL failure reason + the stage we died at into the cron-run meta so it is visible in
    // /api/admin/errors (#77: the build was failing but the cause was invisible there). Re-read the job
    // for the freshest stage; fall back to the pre-build snapshot if that read also fails.
    const failedJob = await fetchNighthawkJob(editionFor).catch(() => null);
    const stage = failedJob?.current_stage ?? job?.current_stage ?? null;
    await logCronRun(CRON_KEY, started, {
      ok: false,
      error: detail,
      reason: `edition_build_failed${stage ? `:${stage}` : ""}`,
      edition_for: editionFor,
      job_status: failedJob?.status ?? job?.status ?? "unknown",
      current_stage: stage,
    });
    // Ops alert on the route-level 500 (#77 was invisible to ops). No-op until DISCORD_OPS_WEBHOOK_URL
    // is set; never throws.
    await notifyOpsDiscord({
      severity: "critical",
      title: `Night Hawk cron edition build FAILED — ${editionFor}`,
      body:
        `stage=${stage ?? "unknown"}\n` +
        `error: ${detail}\n` +
        `[nighthawk-funnel] ${editionFor}: route-level exception (see edition-builder funnel log for stage counts)`,
    }).catch(() => undefined);
    return NextResponse.json(
      {
        ok: false,
        error: "Edition build failed",
        detail,
        edition_for: editionFor,
        job_status: failedJob?.status ?? job?.status ?? "unknown",
        current_stage: stage,
      },
      { status: 500 }
    );
  }
}
