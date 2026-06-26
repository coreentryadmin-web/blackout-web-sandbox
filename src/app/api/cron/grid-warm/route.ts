// Cron: pre-warm the BlackOut Grid market-wide snapshots into Redis (`grid:*` keys).
// Schedule: ~every 1-5 min during market hours (registered in cron-registry.ts as "grid-warm";
// Railway wires the actual fire via railway.grid-warm.toml).
//
// THE POINT (cache-reader rule): the Grid's `/api/grid/*` routes ONLY read Redis snapshots — they
// never fetch upstream per request. This warmer is the single cluster-wide writer, so N viewers
// share ONE upstream pull per window at a fixed cost. Phase 0/1 warms the Analyst Actions feed
// (market-wide Benzinga analyst channel); other Phase-0/1 panels reuse existing feeds (News via
// /api/market/news, Flow via the HELIX stream, Pulse via the SPX desk payload) so they need no warm.
//
// RTH-RESILIENCE (#90): market-hours cron services died mid-RTH before. This route self-skips off
// the in-process ET gate (so the cron can fire on a wide UTC band and the route decides) and logs
// every run via logCronRun, so the cron-staleness-watchdog catches a silent never-fired warmer.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { warmGridAnalysts } from "@/lib/providers/grid";
import { etMinutes, etClock } from "@/lib/spx-play-session-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Regular-trading-hours gate (DST-aware ET via etMinutes), weekdays only. Mirrors heatmap-warm /
 * nights-watch-warm — warm only while the desks are live. `?force=1` overrides for manual warms.
 */
function inMarketHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  const mins = etMinutes(now);
  return mins >= etClock(9, 30) && mins <= etClock(16, 0);
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !inMarketHours()) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside market hours (9:30 AM–4:00 PM ET weekdays) — use ?force=1 to override",
    };
    await logCronRun("grid-warm", started, payload);
    return NextResponse.json(payload);
  }

  // Settle-all so one failing warm can't abort the rest as the Grid grows more panels.
  const results = await Promise.allSettled([warmGridAnalysts()]);

  let warmed = 0;
  for (const r of results) {
    // A fulfilled non-null snapshot is a real warm; a fulfilled null is an empty upstream (counted
    // as a soft miss, not a hard failure — the cache-reader will serve the prior good snapshot).
    if (r.status === "fulfilled" && r.value != null) warmed += 1;
  }
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[cron/grid-warm] ${failed} snapshot warm(s) failed`);
  }

  const allFailed = results.length > 0 && failed === results.length;
  await logCronRun("grid-warm", started, {
    ok: !allFailed,
    warmed,
    failed,
    total: results.length,
    ...(failed > 0 ? { error: `${failed}/${results.length} grid snapshot warm(s) failed` } : {}),
  });

  return NextResponse.json({ ok: true, warmed, total: results.length });
}
