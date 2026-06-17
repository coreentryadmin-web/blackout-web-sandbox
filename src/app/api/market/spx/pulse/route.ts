import { NextResponse } from "next/server";
import { deskPulseCacheTtlMs } from "@/lib/providers/config";
import { buildSpxDeskPulse } from "@/lib/providers/spx-desk";
import { withServerCache } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pulse = await withServerCache("spx-desk-pulse", deskPulseCacheTtlMs(), buildSpxDeskPulse);
    return NextResponse.json(pulse, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/pulse]", error);
    return NextResponse.json({ available: false, error: "Pulse build failed" }, { status: 502 });
  }
}
