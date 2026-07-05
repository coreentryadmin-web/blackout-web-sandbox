import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { fetchGexHeatmap, type GexHeatmap } from "@/lib/providers/polygon-options-gex";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

export type SpxBootstrapPayload = {
  desk: Awaited<ReturnType<typeof loadMergedSpxDesk>>["desk"];
  flow: Awaited<ReturnType<typeof loadMergedSpxDesk>>["flow"];
  pulse: Awaited<ReturnType<typeof loadMergedSpxDesk>>["pulse"];
  merged: Awaited<ReturnType<typeof loadMergedSpxDesk>>["merged"];
  gexHeatmap: GexHeatmap | null;
};

/**
 * One round-trip for dashboard first paint: merged desk lanes + SPX matrix.
 * Individual /spx/pulse, /spx/flow, /spx/desk routes stay for incremental polls.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();

  try {
    const [bundle, gexHeatmap] = await Promise.all([
      loadMergedSpxDesk(),
      fetchGexHeatmap("SPX").catch(() => null),
    ]);

    const payload: SpxBootstrapPayload = {
      desk: bundle.desk,
      flow: bundle.flow,
      pulse: bundle.pulse,
      merged: bundle.merged,
      gexHeatmap,
    };

    return NextResponse.json(roundFloats(payload), { headers: NO_STORE });
  } catch (error) {
    console.error("[market/spx/bootstrap]", error);
    return NextResponse.json({ error: "Bootstrap failed" }, { status: 502, headers: NO_STORE });
  }
}
