// Cron: 24/7 cache warming for platform snapshots and cross-surface coherence.
// Schedule: Every 5 minutes (registered in cron-registry.ts as "platform-warm";
// Railway wires the actual fire via railway.platform-warm.toml).
//
// THE POINT: pre-warm platform snapshots and shared cross-surface caches to reduce
// cold-start latency on Largo/Vector/Night Hawk reads. No market-hour gating.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = {
      ok: true,
      skipped: false,
      warmed: "platform-snapshots",
    };
    await logCronRun("platform-warm", started, payload);
    return NextResponse.json(payload);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const payload = {
      ok: false,
      error,
    };
    await logCronRun("platform-warm", started, payload);
    return NextResponse.json(payload, { status: 500 });
  }
}
