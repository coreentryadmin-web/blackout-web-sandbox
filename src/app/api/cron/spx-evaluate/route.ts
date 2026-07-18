import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { runSpxEvaluator, isSpxEvaluatorPlayResult } from "@/features/spx/lib/spx-evaluator";
import { runLottoPowerHourLocked } from "@/features/spx/lib/spx-lotto-powerhour-runner";
import { buildPlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { isSpxEngineCronWindow } from "@/features/spx/lib/spx-play-session-guards";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { warnIfPlayTimingMisconfigured } from "@/features/spx/lib/spx-play-config";

// Validate timing config on every cold start so container logs surface misconfiguration.
warnIfPlayTimingMisconfigured();

export const dynamic = "force-dynamic";

/** Optional market-hours evaluator — hit from ECS/Vercel cron with CRON_SECRET. */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isSpxEngineCronWindow() && process.env.SPX_CRON_EVAL_ALWAYS !== "1") {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside SPX engine evaluation window (7:00–16:15 ET weekdays)",
    };
    await logCronRun("spx-evaluate", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const { merged } = await loadMergedSpxDesk();
    const technicals = await buildPlayTechnicals(merged.price, {
      vwap: merged.vwap,
      pdh: merged.pdh,
      pdl: merged.pdl,
      hod: merged.hod,
      lod: merged.lod,
    });

    const evalResult = await runSpxEvaluator(merged, technicals, "cron");
    if (!evalResult.ok) {
      throw new Error("error" in evalResult ? evalResult.error : "Evaluation failed");
    }

    if (evalResult.skipped === true) {
      const payload = {
        ok: true,
        skipped: true,
        reason: "lock_held",
      };
      await logCronRun("spx-evaluate", started, payload);
      // Return 200 (not 409) so cron monitoring systems don't treat a lock-held
      // skip as a failure. The payload carries skipped:true for observability.
      return NextResponse.json(payload);
    }

    // Lotto + power-hour run under a single non-blocking advisory lock so a concurrent
    // admin live-mutate run can't race the shared records or double-fire Discord.
    const { lotto, powerHour } = await runLottoPowerHourLocked(merged, technicals);
    if (!isSpxEvaluatorPlayResult(evalResult)) {
      throw new Error("Evaluator returned no play payload");
    }
    const play = evalResult.play;

    const payload = {
      ok: true,
      as_of: merged.polled_at ?? new Date().toISOString(),
      market_open: merged.market_open,
      play_action: play.action,
      play_phase: play.phase,
      play_score: play.score,
      play_grade: play.grade,
      play_blocks: play.gates?.blocks?.slice(0, 3) ?? [],
      lotto_phase: lotto.phase,
      power_hour_phase: powerHour.phase,
    };
    await logCronRun("spx-evaluate", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[spx-evaluate]", detail);
    await logCronRun("spx-evaluate", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Evaluation failed" }, { status: 500 });
  }
}
