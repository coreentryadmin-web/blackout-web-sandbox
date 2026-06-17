import { NextResponse } from "next/server";
import { deskFlowCacheTtlMs } from "@/lib/providers/config";
import { buildSpxDeskFlow } from "@/lib/providers/spx-desk";
import { withServerCache } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

/** Flow lane — GEX, tape, dark pool. Play state lives on /spx/play. */
export async function GET() {
  try {
    const flow = await withServerCache("spx-desk-flow", deskFlowCacheTtlMs(), buildSpxDeskFlow, {
      staleWhileRevalidate: false,
    });

    return NextResponse.json(flow, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/flow]", error);
    return NextResponse.json({ available: false, error: "Flow build failed" }, { status: 502 });
  }
}
