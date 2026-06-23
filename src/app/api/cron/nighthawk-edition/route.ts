import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction, fetchNighthawkJob } from "@/lib/db";
import { buildEveningEdition } from "@/lib/nighthawk/edition-builder";
import { isWeekdayEt, etNowParts, nextTradingDayEt, todayEt } from "@/lib/nighthawk/session";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";

const CRON_KEY = "nighthawk-playbook";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    const result = await buildEveningEdition({ force });
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
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/nighthawk-edition]", error);
    await logCronRun(CRON_KEY, started, { ok: false, error: detail });
    return NextResponse.json(
      {
        ok: false,
        error: "Edition build failed",
        detail,
        edition_for: editionFor,
        job_status: job?.status ?? "unknown",
        current_stage: job?.current_stage ?? null,
      },
      { status: 500 }
    );
  }
}
