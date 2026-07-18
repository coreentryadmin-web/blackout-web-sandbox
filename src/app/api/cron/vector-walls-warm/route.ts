// Cron: pre-warm Vector GEX/VEX walls cache for the universe.
// Schedule: ~every 15-30s during market hours (registered in cron-registry.ts as
// "vector-walls-warm"; ECS task definition wires the actual fire).
//
// THE POINT: The Vector SSE stream /api/market/vector/stream ticks at 1 Hz and calls
// buildVectorStreamPayload which re-computes walls from scratch if the cache (WALLS_CACHE_MS=900ms)
// expires. With 5-10 minute cron warming, the cache is cold >99% of the time, forcing expensive
// wall computations on every single tick. This cron keeps walls pre-computed so SSE sees cache
// hits and streams fast, giving users real-time wall updates without the "static all day"
// perception. With a 15-30s warm cycle + 8-900ms cache, walls stay warm for all concurrent viewers.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { warmVectorWalls, getTickersToWarm } from "@/features/vector/lib/vector-walls-warm";
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
    await logCronRun("vector-walls-warm", started, payload);
    return NextResponse.json(payload);
  }

  const allowlist = vectorUniverseTickers();
  const tickers = getTickersToWarm(allowlist);

  // Warm all walls in parallel; settle all so one failing underlying can't abort the rest.
  const results = await Promise.allSettled(
    tickers.map((t) => warmVectorWalls(t))
  );

  let warmed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      warmed += 1;
    }
  }
  const failed = results.length - warmed;

  await logCronRun("vector-walls-warm", started, {
    ok: warmed > 0,
    warmed,
    failed,
    allowlistCount: allowlist.length,
    dynamicCount: tickers.length - allowlist.length,
    total: tickers.length,
  });

  return NextResponse.json({
    ok: true,
    warmed,
    allowlistCount: allowlist.length,
    dynamicCount: tickers.length - allowlist.length,
    total: tickers.length,
  });
}
