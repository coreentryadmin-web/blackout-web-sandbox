import { NextRequest, NextResponse } from "next/server";
import { runFlowIngest, ingestInFlight } from "@/lib/providers/flow-ingest";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (ingestInFlight) {
    await logCronRun("flow-ingest", started, { ok: true, skipped: true, reason: "ingest_in_flight" });
    return NextResponse.json({ ok: true, skipped: "ingest_in_flight" });
  }

  try {
    const result = await runFlowIngest();
    await logCronRun("flow-ingest", started, {
      ok: true,
      skipped: Boolean(result.skipped),
      reason: typeof result.skipped === "string" ? result.skipped : undefined,
      ingested: result.ingested,
      polled: result.polled,
    });
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/flow-ingest]", error);
    await logCronRun("flow-ingest", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Ingest failed" }, { status: 500 });
  }
}
