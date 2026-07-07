// Cron: warm 0DTE Command's earnings-match cache + run its always-on scanner tick.
// Schedule: ~every 1-5 min during market hours (registered in cron-registry.ts as
// "zerodte-warm"; Railway wires the actual fire via railway.zerodte-warm.toml).
//
// HISTORY (renamed 2026-07-07 when classic Grid was deleted): this route used to be
// "grid-warm" and pre-warmed 8 classic-Grid market-wide panel snapshots (Analyst Actions,
// Dark Pool, Congress, Economy, Sectors, Movers, Catalysts, Earnings) PLUS ran
// warmZeroDteBoard() as a 9th, unrelated item tacked onto the same Promise.allSettled tick.
// Classic Grid (the page, its 17 components, its 9 API routes) was deleted wholesale, but
// warmZeroDteBoard() is 0DTE Command's OWN always-on scanner tick — every ~2-min run scans
// the HELIX tape for fresh single-name 0DTE concentration and upserts the live session
// ledger (zerodte_setup_log). Deleting this route outright would have silently killed that
// scanner, so instead of deleting it, it's renamed and stripped down to ONLY the two things
// 0DTE Command actually needs: its earnings-match cache warm (readGridEarnings() in
// zerodte-service.ts flags setups reporting today/tomorrow) and the scanner tick itself.
//
// RTH-RESILIENCE (#90): market-hours cron services died mid-RTH before. This route self-skips off
// the in-process ET gate (so the cron can fire on a wide UTC band and the route decides) and logs
// every run via logCronRun, so the cron-staleness-watchdog catches a silent never-fired warmer.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { warmGridEarnings } from "@/lib/zerodte/earnings";
import { warmZeroDteBoard } from "@/lib/zerodte/scan";
import { isEtCashRth } from "@/lib/et-market-hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside cash RTH (weekday 9:30 AM–4:00 PM ET, excluding holidays/early-close) — use ?force=1 to override",
    };
    await logCronRun("zerodte-warm", started, payload);
    return NextResponse.json(payload);
  }

  // Settle-all so one failing warm can't abort the other.
  const results = await Promise.allSettled([
    warmGridEarnings(),
    // 0DTE Command scanner — the always-on hunt. Every ~2-min tick scans the HELIX
    // tape for fresh single-name 0DTE concentration, enriches the top finds through
    // the Night Hawk dossier, and upserts the session ledger (zerodte_setup_log) so
    // the board's "flagged today" record accumulates whether or not anyone is looking.
    warmZeroDteBoard(),
  ]);

  let warmed = 0;
  for (const r of results) {
    // A fulfilled non-null snapshot is a real warm; a fulfilled null is an empty upstream (counted
    // as a soft miss, not a hard failure — the cache-reader will serve the prior good snapshot).
    if (r.status === "fulfilled" && r.value != null) warmed += 1;
  }
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[cron/zerodte-warm] ${failed} snapshot warm(s) failed`);
  }

  const allFailed = results.length > 0 && failed === results.length;
  await logCronRun("zerodte-warm", started, {
    ok: !allFailed,
    warmed,
    failed,
    total: results.length,
    ...(failed > 0 ? { error: `${failed}/${results.length} zerodte-warm snapshot warm(s) failed` } : {}),
  });

  return NextResponse.json({ ok: true, warmed, total: results.length });
}
