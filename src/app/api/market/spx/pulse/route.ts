import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSpxDeskPulse } from "@/features/spx/lib/spx-desk-loader";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  try {
    const pulse = await loadSpxDeskPulse();
    // Round at the response boundary — same data-layer fix every other SPX route applies. The pulse
    // build serves raw GEX/greek/price floats (e.g. gex_net, gamma_flip, dark-pool sums) that carry
    // IEEE-754 noise (7499.360000000001); this was the only SPX route missing the shaping. Integers
    // (epoch-ms timestamps, counts) pass through untouched — roundFloats short-circuits them.
    return NextResponse.json(roundFloats(pulse), {
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
