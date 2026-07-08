// Cron: pre-warm the shared SPX desk cache lanes (desk + flow + pulse) and the SPX
// GEX heatmap matrix used by the dashboard left rail.
// Schedule: ~every 5 min during RTH on Railway (5-minute floor); in-app rth-warm-leader
// backs up at ~90s when cron stalls (registered in cron-registry.ts as "desk-warm";
// Railway wires the fire via railway.desk-warm.toml).
//
// THE POINT: buildSpxDesk() is UW-bound (~2–5s cold). User polls hit loadSpxDesk() /
// loadMergedSpxDesk(), which share a single Redis/in-process cache with SWR. Without a
// warmer, the first member poll after each TTL expiry blocks on the full rebuild. This
// cron keeps those lanes hot so dashboard XHR stays sub-second during RTH.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { loadBootstrapBundle, loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { prefetchSpxDeskEnrichment } from "@/features/spx/lib/spx-desk";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { seedUwCacheFromWsStores } from "@/lib/uw-ws-cache-bridge";
import { shouldRunCacheWarmer } from "@/lib/cache-warmer-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    await logCronRun("desk-warm", started, payload);
    return NextResponse.json(payload);
  }

  const [mergedResult, gexResults, bootstrapResult] = await Promise.allSettled([
    loadMergedSpxDesk(),
    Promise.allSettled(["SPX", "SPY"].map((t) => fetchGexHeatmap(t))),
    loadBootstrapBundle(),
  ]);

  try {
    const redis = await getUwCacheRedis();
    if (redis) await seedUwCacheFromWsStores(redis);
  } catch {
    /* non-fatal */
  }

  const deskOk = mergedResult.status === "fulfilled";
  const gexOk =
    gexResults.status === "fulfilled" &&
    gexResults.value.some((r) => r.status === "fulfilled");
  const bootstrapOk = bootstrapResult.status === "fulfilled";

  let enrichOk = false;
  let bootstrapEnrichedOk = bootstrapOk;
  try {
    await prefetchSpxDeskEnrichment();
    enrichOk = true;
    await loadBootstrapBundle();
    bootstrapEnrichedOk = true;
  } catch {
    enrichOk = false;
    bootstrapEnrichedOk = false;
  }

  if (!deskOk) {
    console.warn(
      "[cron/desk-warm] loadMergedSpxDesk failed:",
      mergedResult.status === "rejected" ? mergedResult.reason : "unknown"
    );
  }
  if (!gexOk) {
    console.warn(
      "[cron/desk-warm] fetchGexHeatmap(SPX/SPY) failed:",
      gexResults.status === "rejected" ? gexResults.reason : "all tickers failed"
    );
  }

  const allFailed = !deskOk && !gexOk && !bootstrapOk;
  await logCronRun("desk-warm", started, {
    ok: !allFailed,
    desk: deskOk,
    gex: gexOk,
    bootstrap: bootstrapOk,
    enrich: enrichOk,
    bootstrap_enriched: bootstrapEnrichedOk,
    ...(allFailed ? { error: "desk, gex, and bootstrap warm all failed" } : {}),
  });

  return NextResponse.json({
    ok: !allFailed,
    desk: deskOk,
    gex: gexOk,
    bootstrap: bootstrapOk,
    enrich: enrichOk,
    bootstrap_enriched: bootstrapEnrichedOk,
  });
}
