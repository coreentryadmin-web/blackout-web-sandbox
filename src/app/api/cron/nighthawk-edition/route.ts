import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction, fetchNighthawkJob } from "@/lib/db";
import { buildEveningEdition } from "@/lib/nighthawk/edition-builder";
import { isWeekdayEt, etNowParts, nextTradingDayEt, todayEt } from "@/lib/nighthawk/session";
import { isCronAuthorized } from "@/lib/market-api-auth";

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
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  if (!editionEnabled()) {
    return NextResponse.json({ ok: false, skipped: true, reason: "NIGHTHAWK_EDITION_ENABLED=0" });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const statusOnly = req.nextUrl.searchParams.get("status") === "1";
  const editionFor = nextTradingDayEt(todayEt());
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
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "Outside edition window — use ?force=1 to nudge/resume",
      edition_for: editionFor,
      job_status: job?.status ?? "none",
      current_stage: job?.current_stage ?? null,
    });
  }

  try {
    const result = await buildEveningEdition({ force });
    const status = result.ok ? 200 : result.job_status === "failed" ? 500 : 202;
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
