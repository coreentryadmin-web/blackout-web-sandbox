import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { warmVectorDarkPool } from "@/features/vector/lib/vector-dark-pool-cache";
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
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-dark-pool-warm", started, payload);
    return NextResponse.json(payload);
  }

  const tickers = vectorUniverseTickers();
  const results = await Promise.allSettled(tickers.map((t) => warmVectorDarkPool(t)));

  // warmVectorDarkPool swallows UW errors internally and reports them via
  // fetchFailed — counting only Promise rejections here made a total UW outage
  // report ok:true / failed:0 while serving nothing (watchdog-blind).
  let warmed = 0;
  let levels = 0;
  let fetchFailed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.fetchFailed) {
        fetchFailed += 1;
      } else {
        warmed += 1;
        levels += r.value.levels;
      }
    }
  }
  const rejected = results.length - warmed - fetchFailed;
  const failed = fetchFailed + rejected;

  const payload = {
    ok: failed < results.length,
    warmed,
    failed,
    fetch_failed: fetchFailed,
    total: tickers.length,
    levels,
  };
  await logCronRun("vector-dark-pool-warm", started, payload);
  return NextResponse.json(payload);
}
