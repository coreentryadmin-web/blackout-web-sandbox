import { NextResponse } from "next/server";
import { deskCacheTtlMs, deskFlowCacheTtlMs, deskPulseCacheTtlMs } from "@/lib/providers/config";
import {
  buildSpxDesk,
  buildSpxDeskFlow,
  buildSpxDeskPulse,
} from "@/lib/providers/spx-desk";
import { evaluateSpxPlay } from "@/lib/spx-play-engine";
import { mergeFlowIntoDesk, mergePulseIntoDesk } from "@/lib/spx-desk-merge";
import { withServerCache } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [desk, flow, pulse] = await Promise.all([
      withServerCache("spx-desk", deskCacheTtlMs(), buildSpxDesk, {
        staleWhileRevalidate: false,
      }),
      withServerCache("spx-desk-flow", deskFlowCacheTtlMs(), buildSpxDeskFlow, {
        staleWhileRevalidate: false,
      }),
      withServerCache("spx-desk-pulse", deskPulseCacheTtlMs(), buildSpxDeskPulse, {
        staleWhileRevalidate: false,
      }),
    ]);

    let merged = desk;
    if (flow?.available) merged = mergeFlowIntoDesk(merged, flow);
    if (pulse) {
      if (pulse.available) merged = mergePulseIntoDesk(merged, pulse);
      else {
        merged = {
          ...merged,
          market_open: pulse.market_open,
          market_status: pulse.market_status,
          market_label: pulse.market_label,
          polled_at: pulse.polled_at,
        };
      }
    }

    const play = await evaluateSpxPlay(merged);

    return NextResponse.json(play, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/play]", error);
    return NextResponse.json(
      { available: false, action: "SCANNING", error: "Play engine failed" },
      { status: 502 }
    );
  }
}
