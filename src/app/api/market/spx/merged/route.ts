import { NextResponse } from "next/server";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";

export const dynamic = "force-dynamic";

/** Merged SPX Sniper desk — pulse + flow + full desk (same feed as dashboard & play engine). */
export async function GET() {
  try {
    const { merged, pulse, flow } = await loadMergedSpxDesk();
    return NextResponse.json(
      {
        merged,
        pulse_available: pulse?.available ?? false,
        flow_available: flow?.available ?? false,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("[market/spx/merged]", error);
    return NextResponse.json({ available: false, error: "Merged desk build failed" }, { status: 502 });
  }
}
