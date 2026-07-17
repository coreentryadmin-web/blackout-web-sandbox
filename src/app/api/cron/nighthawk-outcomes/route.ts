import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import {
  nighthawkOutcomesRunHealth,
  resolvePendingNighthawkOutcomes,
} from "@/features/nighthawk/lib/play-outcomes";
import {
  runNighthawkDebriefPass,
  runNighthawkRejectionCounterfactuals,
  type NighthawkDebriefPassResult,
  type NighthawkRejectionCfResult,
} from "@/features/nighthawk/lib/debrief-persist";
import { inEtWindow } from "@/features/nighthawk/lib/et-window";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function inOutcomeWindow(force: boolean): boolean {
  if (force) return true;
  // DST-aware window (America/New_York). The EventBridge cron now fires at both 20:30 and
  // 21:30 UTC so 16:30 ET is hit in EDT and EST; this guard self-skips the off-band fire.
  return inEtWindow({
    targetHour: Number(process.env.NIGHTHAWK_OUTCOMES_HOUR_ET ?? "16"),
    targetMinute: Number(process.env.NIGHTHAWK_OUTCOMES_MINUTE_ET ?? "30"),
    catchupMin: Number(process.env.NIGHTHAWK_OUTCOMES_CATCHUP_MIN ?? "90"),
  });
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!inOutcomeWindow(force)) {
    const payload = {
      ok: false,
      skipped: true,
      reason: "Outside outcome window (4:30 PM ET) — use ?force=1 to override",
    };
    await logCronRun("nighthawk-outcomes", started, payload);
    return NextResponse.json(payload);
  }

  try {
    // Guard against a non-numeric ?days override: Number("abc") → NaN, which would bind to
    // the $1::int SQL param and make Postgres throw "invalid input syntax for type integer".
    // Fall back to the 7-day default for anything non-finite or non-positive.
    const rawDays = Number(req.nextUrl.searchParams.get("days") ?? "7");
    const lookbackDays = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 7;
    const result = await resolvePendingNighthawkOutcomes({ lookbackDays });
    // Cron honesty (PR-N1): per-row grade-write failures used to be tucked into
    // meta.errors under an unconditional ok:true — the H-1 constraint clobber failed
    // 12 grades for four straight days while cron-health stayed green. errors with
    // content ⇒ the run FAILED (health record + ops ping via logCronRun) and the HTTP
    // status says so too.
    const health = nighthawkOutcomesRunHealth(result);

    // PR-N10: the Debrief pass, strictly AFTER grading — pins the per-play post-mortem
    // onto newly-graded rows and counterfactually grades PR-N3's publish-gate-blocked
    // plays on the same daily-bar path. FAIL-SOFT BY CONTRACT: both passes report their
    // own honest ledgers in the payload/meta, but neither can fail the grading run —
    // `health` above (the run's ok + HTTP status) is computed from grading alone, and
    // the belt-and-suspenders catch here covers even a pass that throws unexpectedly.
    const nowMs = Date.now();
    const debrief: NighthawkDebriefPassResult = await runNighthawkDebriefPass({ nowMs }).catch((err) => ({
      ok: false,
      scanned: 0,
      pinned: 0,
      already_pinned: 0,
      skipped: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    }));
    const rejectionCf: NighthawkRejectionCfResult = await runNighthawkRejectionCounterfactuals({
      nowMs,
    }).catch((err) => ({
      ok: false,
      scanned: 0,
      graded: 0,
      ungradeable: 0,
      skipped_no_bar: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    }));

    const payload = { ok: health.ok, ...result, debrief, rejection_counterfactuals: rejectionCf };
    await logCronRun("nighthawk-outcomes", started, {
      ok: health.ok,
      error: health.error,
      resolved: result.resolved,
      skipped_count: result.skipped,
      errors: result.errors,
      debrief,
      rejection_counterfactuals: rejectionCf,
    });
    return NextResponse.json(payload, health.ok ? undefined : { status: 500 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/nighthawk-outcomes]", error);
    await logCronRun("nighthawk-outcomes", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Outcome resolution failed", detail }, { status: 500 });
  }
}
