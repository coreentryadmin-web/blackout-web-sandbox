import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { runSpxEvaluator, isSpxEvaluatorPlayResult } from "@/lib/spx-evaluator";
import { evaluateSpxLotto } from "@/lib/spx-lotto-engine";
import { evaluateSpxPowerHour } from "@/lib/spx-power-hour-engine";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";
import { isSpxEngineCronWindow } from "@/lib/spx-play-session-guards";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { warnIfPlayTimingMisconfigured } from "@/lib/spx-play-config";

// Validate timing config on every cold start so Railway logs surface misconfiguration.
warnIfPlayTimingMisconfigured();

export const dynamic = "force-dynamic";

/** Optional market-hours evaluator — hit from Railway/Vercel cron with CRON_SECRET. */
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
      reason: "Outside SPX engine evaluation window (7:00–16:00 ET weekdays)",
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

    const [lotto, powerHour] = await Promise.all([
      evaluateSpxLotto(merged, technicals),
      evaluateSpxPowerHour(merged, technicals),
    ]);
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
