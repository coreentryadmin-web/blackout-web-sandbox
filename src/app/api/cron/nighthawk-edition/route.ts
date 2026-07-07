import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { requireDatabaseInProduction, fetchNighthawkJob, failStaleNighthawkJobs } from "@/lib/db";
import { buildEveningEdition, serializeBuildError } from "@/features/nighthawk/lib/edition-builder";
import { isWeekdayEt, etNowParts, nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";

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
  const todayInEt = todayEt();
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

  await failStaleNighthawkJobs().catch((err) =>
    console.warn("[cron/nighthawk-edition] stale-job cleanup failed:", err)
  );

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

  // FIRE-AND-FORGET (#77 hardening D). Previously this route AWAITED the multi-minute build and
  // raced it against an internal budget, so the cron HTTP handshake routinely outlived hit-cron's
  // 60s timeout — every nightly run logged as FAILED even when the edition published fine (the
  // "every nightly run logs as failed" lie). Now we dispatch the build in the background via
  // next/server `after()` (runs after the response is flushed, on the long-lived Railway worker) and
  // return 202 in well under 60s. The builder checkpoints + publishes on its own; its background
  // `.catch` serializes + ops-alerts so an unhandled rejection can NEVER crash the replica. A re-fire
  // (cron schedule or ?force=1) resumes from the last checkpoint exactly as before.
  const dispatchBuild = () => {
    void buildEveningEdition({ force })
      .then((result) => {
        if (result.ok) {
          console.info(
            `[cron/nighthawk-edition] background build done — ${result.edition_for} ` +
              `status=${result.job_status ?? "?"} stage=${result.current_stage ?? "?"} plays=${result.plays_count}`
          );
        } else {
          // The builder itself already ops-alerts on a hard failure; this is the route-side log so the
          // background outcome is visible in worker logs even if Discord is unset.
          console.error(
            `[cron/nighthawk-edition] background build returned not-ok — ${result.edition_for} ` +
              `status=${result.job_status ?? "?"} stage=${result.current_stage ?? "?"} error=${result.error ?? "?"}`
          );
        }
      })
      .catch(async (error) => {
        // Defensive: buildEveningEdition has its own try/catch and shouldn't reject, but if anything
        // slips through, serialize + ops-alert HERE so it can never become an unhandledRejection that
        // takes down the replica.
        const detail = serializeBuildError(error);
        console.error("[cron/nighthawk-edition] background build REJECTED:", error);
        const failedJob = await fetchNighthawkJob(editionFor).catch(() => null);
        const stage = failedJob?.current_stage ?? job?.current_stage ?? null;
        await notifyOpsDiscord({
          severity: "critical",
          title: `Night Hawk background edition build REJECTED — ${editionFor}`,
          body:
            `stage=${stage ?? "unknown"}\n` +
            `error: ${detail}\n` +
            `[nighthawk-funnel] ${editionFor}: background rejection (see edition-builder funnel log for stage counts)`,
        }).catch(() => undefined);
      });
  };

  // Prefer next/server after() (platform-managed background work bound to the server, not the HTTP
  // response). It is a no-op fallback to a detached promise if after() ever throws (e.g. called
  // outside a request scope), so the build always gets dispatched.
  try {
    after(dispatchBuild);
  } catch {
    dispatchBuild();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "build dispatched in background (fire-and-forget)",
    edition_for: editionFor,
    job_status: job?.status ?? "running",
    current_stage: job?.current_stage ?? "stage_context",
  };
  // Log SUCCESS for the handshake: the build was accepted + dispatched. This is the honest signal —
  // the cron trigger's job is to KICK the build, and it succeeded. The build's own outcome
  // (published / failed) is tracked separately via the nighthawk_job row + the watchdog.
  await logCronRun(CRON_KEY, started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Edition build dispatched in background — poll ?status=1 or the admin cron dashboard for completion.",
    },
    { status: 202 }
  );
}
