import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { refreshVectorUniverseSnapshot, loadSessionWallHistory } from "@/features/vector";
import { isEtCashRth } from "@/lib/et-market-hours";
import { todayEt } from "@/features/nighthawk/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-universe-snapshot", started, payload);
    return NextResponse.json(payload);
  }

  try {
    // Record wall-history samples for the whole universe on every RTH run — the
    // server-side source for the chart's bead rails, so they persist after-hours
    // and exist for every covered ticker (not just ones with a live viewer).
    // Only this RTH-gated cron records; inline scanner polls must not.
    const sessionYmd = todayEt();
    const snap = await refreshVectorUniverseSnapshot({
      recordWallHistory: true,
      sessionYmd,
    });
    // Read-back verification of the flagship rail. The recorder persists to Redis as
    // a side effect, but a green {ok, rows} said nothing about whether the wall-history
    // rail actually grew — a session-long persistence gap (empty off-hours SPX rail)
    // hid behind a passing cron for hours. Reading SPX's rail straight back after the
    // build turns durability into an observable number: force-run twice and railLen
    // must increment; if it stays flat while rows=21, the write path (not the fetch)
    // is the problem. Best-effort — a read hiccup must not fail the recording run.
    const spxRailLen = await loadSessionWallHistory(sessionYmd, "SPX")
      .then((h) => h.length)
      .catch(() => -1);
    const payload = {
      ok: true,
      rows: snap.rows.length,
      spxRailLen,
      sessionYmd,
      updatedAt: snap.updatedAt,
    };
    await logCronRun("vector-universe-snapshot", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await logCronRun("vector-universe-snapshot", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "vector-universe-snapshot failed" }, { status: 500 });
  }
}
