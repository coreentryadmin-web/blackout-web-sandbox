// Cron: pre-warm the shared GEX heatmap matrix cache for the ~11 Heat Maps presets.
// Schedule: ~every 30-45s during market hours (registered in cron-registry.ts as
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
//
// DELTA BROADCAST: after warming each preset, calculate the delta vs. the previous snapshot
// and broadcast to all active SSE subscribers (/api/market/gex-matrix-deltas). This gives
// real-time perception (10-15s) while keeping the full rebuild to 30-45s cadence.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { vectorWarmTickers } from "@/lib/heatmap-allowlist";
import { shouldRunCacheWarmer } from "@/lib/cache-warmer-gate";
import { calculateMatrixDelta, type GexMatrix } from "@/lib/gex-matrix-delta";
import { broadcastMatrixDelta } from "@/lib/gex-matrix-broadcast";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!shouldRunCacheWarmer(force)) {
    const payload = {
      ok: true,
      skipped: true,
      reason:
        "Outside extended warm window (weekday 4:00 AM–8:00 PM ET) — use ?force=1 or set CACHE_WARM_ALWAYS=1",
    };
    await logCronRun("heatmap-warm", started, payload);
    return NextResponse.json(payload);
  }

  const tickers = vectorWarmTickers();

  // fetchGexHeatmap dedups per ticker via the matrix cache + single-flight guard, so warming each
  // once is enough. Settle-all so one failing underlying can't abort the rest. A null result
  // (unconfigured / no spot) is still a successful warm — the empty/negative result is cached and
  // shields that ticker from per-user re-hammering for the TTL window.
  const results = await Promise.allSettled(tickers.map((t) => fetchGexHeatmap(t)));

  let warmed = 0;
  let deltasBroadcast = 0;
  const broadcastErrors: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") continue;

    warmed += 1;

    const ticker = tickers[i];
    const gexHeatmap = r.value;

    // Skip delta calculation if current snapshot is unavailable
    if (!gexHeatmap) continue;

    try {
      // Adapt GexHeatmap to GexMatrix format for delta calculation
      // (extract just the fields needed: underlying, spot, strikes, expiries, gex cells, asof)
      const currentSnapshot: GexMatrix = {
        underlying: gexHeatmap.underlying,
        spot: gexHeatmap.spot,
        strikes: gexHeatmap.strikes,
        expiries: gexHeatmap.expiries,
        gex: gexHeatmap.gex.cells,
        asof: gexHeatmap.asof,
      };

      // Get previous snapshot from cache
      const cacheKey = `gex-matrix-snapshot:${ticker}`;
      let previousSnapshot: GexMatrix | null = null;
      try {
        previousSnapshot = await sharedCacheGet<GexMatrix>(cacheKey);
      } catch {
        // Redis optional; continue without previous snapshot
      }

      // Calculate delta vs. previous snapshot
      const delta = calculateMatrixDelta(previousSnapshot, currentSnapshot);
      if (delta) {
        // Broadcast delta to all SSE subscribers
        await broadcastMatrixDelta(delta);
        deltasBroadcast += 1;
      }

      // Store current snapshot for next delta calculation
      try {
        const snapshotTtlSec = 120; // 2 minutes; cron fires ~every 30-45s
        await sharedCacheSet(cacheKey, currentSnapshot, snapshotTtlSec).catch(() => {
          // Redis optional; log but continue
          console.warn(`[cron/heatmap-warm] Failed to cache snapshot for ${ticker}`);
        });
      } catch {
        /* ignored */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[cron/heatmap-warm] Delta broadcast failed for ${ticker}: ${msg}`);
      broadcastErrors.push(`${ticker}: ${msg}`);
    }
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
    deltasBroadcast,
    total: tickers.length,
    ...(failed > 0 ? { error: `${failed}/${tickers.length} preset warm(s) failed` } : {}),
    ...(broadcastErrors.length > 0 ? { broadcastErrors } : {}),
  });

  return NextResponse.json({
    ok: true,
    warmed,
    total: tickers.length,
    deltasBroadcast,
  });
}
