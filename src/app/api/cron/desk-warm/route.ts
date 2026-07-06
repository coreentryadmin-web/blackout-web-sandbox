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
import { loadBootstrapBundle, loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { isEtCashRth } from "@/lib/et-market-hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
      reason:
        "Outside cash RTH (weekday 9:30 AM–4:00 PM ET, excluding holidays/early-close) — use ?force=1 to override",
    };
    await logCronRun("desk-warm", started, payload);
    return NextResponse.json(payload);
  }

  const [mergedResult, gexResult, bootstrapResult] = await Promise.allSettled([
    loadMergedSpxDesk(),
    fetchGexHeatmap("SPX"),
    loadBootstrapBundle(),
  ]);

  const deskOk = mergedResult.status === "fulfilled";
  const gexOk = gexResult.status === "fulfilled";
  const bootstrapOk = bootstrapResult.status === "fulfilled";

  if (!deskOk) {
    console.warn(
      "[cron/desk-warm] loadMergedSpxDesk failed:",
      mergedResult.status === "rejected" ? mergedResult.reason : "unknown"
    );
  }
  if (!gexOk) {
    console.warn(
      "[cron/desk-warm] fetchGexHeatmap(SPX) failed:",
      gexResult.status === "rejected" ? gexResult.reason : "unknown"
    );
  }

  const allFailed = !deskOk && !gexOk && !bootstrapOk;
  await logCronRun("desk-warm", started, {
    ok: !allFailed,
    desk: deskOk,
    gex: gexOk,
    bootstrap: bootstrapOk,
    ...(allFailed ? { error: "desk, gex, and bootstrap warm all failed" } : {}),
  });

  return NextResponse.json({
    ok: !allFailed,
    desk: deskOk,
    gex: gexOk,
    bootstrap: bootstrapOk,
  });
}
