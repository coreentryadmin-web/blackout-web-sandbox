import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { evaluateSpxPlay } from "@/lib/spx-play-engine";
import { evaluateSpxLotto } from "@/lib/spx-lotto-engine";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";
import { isSpxEngineCronWindow } from "@/lib/spx-play-session-guards";
import { recordPlayEngineTick } from "@/lib/play-engine-heartbeat";

export const dynamic = "force-dynamic";

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const q = req.nextUrl.searchParams.get("secret");
  return auth === secret || q === secret;
}

/** Optional market-hours evaluator — hit from Railway/Vercel cron with CRON_SECRET. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isSpxEngineCronWindow() && process.env.SPX_CRON_EVAL_ALWAYS !== "1") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Outside SPX engine evaluation window (7:00–16:00 ET weekdays)",
    });
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

    const [play, lotto] = await Promise.all([
      evaluateSpxPlay(merged, technicals),
      evaluateSpxLotto(merged, technicals),
    ]);
    recordPlayEngineTick("cron");

    return NextResponse.json({
      ok: true,
      as_of: merged.polled_at ?? new Date().toISOString(),
      market_open: merged.market_open,
      play_action: play.action,
      play_phase: play.phase,
      lotto_phase: lotto.phase,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/spx-evaluate]", error);
    return NextResponse.json({ ok: false, error: "Evaluation failed", detail }, { status: 500 });
  }
}
