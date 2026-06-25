// Cron: pre-warm the shared GEX heatmap matrix cache for the ~11 Heat Maps presets.
// Schedule: ~every 20-30s during market hours (registered in cron-registry.ts as
// "heatmap-warm"; Railway wires the actual fire via railway.heatmap-warm.toml).
//
// THE POINT: the Heat Maps UI / Largo explain / gex-positioning all read fetchGexHeatmap(ticker),
// which dedups per ticker through the in-memory + Redis matrix cache (and a single-flight guard).
// Today the presets are warmed only by ORGANIC traffic, so a TTL expiry under burst causes a
// cold-build spike (N users racing N chain fetches before the cache fills). This cron warms each
// preset ONCE per tick so user-facing reads stay pure cache hits and the cold-build burst never
// happens. All upstream calls flow through the permissive Polygon rate-limiter, so a warm burst
// can't trip the 429 breaker on the live desk / GEX path. Overlays (UW) are NOT warmed here — the
// matrix is the only thing that goes cold; overlays are gated separately by the allowlist.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { heatmapPresetTickers } from "@/lib/heatmap-allowlist";
import { etMinutes, etClock } from "@/lib/spx-play-session-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Regular-trading-hours gate (DST-aware ET via etMinutes), weekdays only. Mirrors
 * nights-watch-warm — warm only while the chains actually move. `?force=1` overrides for
 * manual warms / off-hours testing.
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
    await logCronRun("heatmap-warm", started, payload);
    return NextResponse.json(payload);
  }

  const tickers = heatmapPresetTickers();

  // fetchGexHeatmap dedups per ticker via the matrix cache + single-flight guard, so warming each
  // once is enough. Settle-all so one failing underlying can't abort the rest. A null result
  // (unconfigured / no spot) is still a successful warm — the empty/negative result is cached and
  // shields that ticker from per-user re-hammering for the TTL window.
  const results = await Promise.allSettled(tickers.map((t) => fetchGexHeatmap(t)));

  let warmed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") warmed += 1;
  }
  const failed = results.length - warmed;
  if (failed > 0) {
    console.warn(`[cron/heatmap-warm] ${failed} preset warm(s) failed`);
  }

  // ok:false (=> failed status + critical alert) only when the WHOLE batch fails; a partial
  // failure logs ok with the count so one flaky underlying doesn't page ops.
  const allFailed = tickers.length > 0 && failed === tickers.length;
  await logCronRun("heatmap-warm", started, {
    ok: !allFailed,
    warmed,
    failed,
    total: tickers.length,
    ...(failed > 0 ? { error: `${failed}/${tickers.length} preset warm(s) failed` } : {}),
  });

  return NextResponse.json({ ok: true, warmed, total: tickers.length });
}
