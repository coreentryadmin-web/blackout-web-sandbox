import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadBootstrapBundle, type MergedSpxDeskBundle } from "@/features/spx/lib/spx-desk-loader";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

export type SpxBootstrapPayload = {
  desk: MergedSpxDeskBundle["desk"];
  flow: MergedSpxDeskBundle["flow"];
  pulse: MergedSpxDeskBundle["pulse"];
  merged: MergedSpxDeskBundle["merged"];
  /** Deprecated — matrix loads via /gex-heatmap (own cache lane). Kept for older clients. */
  gexHeatmap: null;
};

/**
 * One round-trip for dashboard first paint: merged desk lanes only.
 * SPX matrix uses /gex-heatmap (desk-warm keeps both caches hot). Bundling the full
 * matrix here caused Cloudflare 524 timeouts on cold cache (~125s) and forced the
 * client to fall back to 4 parallel lane XHRs — the main source of ~10s dashboard loads.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  try {
    const bundle = await loadBootstrapBundle();

    const payload: SpxBootstrapPayload = {
      desk: bundle.desk,
      flow: bundle.flow,
      pulse: bundle.pulse,
      merged: bundle.merged,
      gexHeatmap: null,
    };

    return NextResponse.json(roundFloats(payload), { headers: NO_STORE });
  } catch (error) {
    console.error("[market/spx/bootstrap]", error);
    return NextResponse.json({ error: "Bootstrap failed" }, { status: 502, headers: NO_STORE });
  }
}
