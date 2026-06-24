import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { getGexPositioning } from "@/lib/providers/gex-positioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/market/gex-positioning?ticker=SPY — the CANONICAL internal GEX/VEX
 * positioning surface. Any service/tool/AI surface can GET this to read the SAME
 * dealer-positioning the Heat Maps UI shows, from ONE source.
 *
 * This is the LIGHT positioning contract: it reads ONLY the shared GEX matrix cache
 * via getGexPositioning (cache-reader) and NEVER fetches overlays (HELIX flow /
 * dark-pool), so it can't pressure the UW 2-RPS cluster-wide budget regardless of
 * caller count. Premium Clerk session OR cron secret, matching the sibling
 * gex-heatmap route. Returns 200 with { available:false, ticker } when no matrix
 * exists — never fabricated, never throws to the client.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();

  const noStore = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

  try {
    const positioning = await getGexPositioning(ticker);
    if (!positioning) {
      // Cold / empty matrix — never fabricate. Mirrors the heatmap empty contract.
      return NextResponse.json(
        { available: false, ticker },
        { status: 200, headers: noStore }
      );
    }
    return NextResponse.json(
      { available: true, ...positioning },
      { status: 200, headers: noStore }
    );
  } catch (error) {
    console.error("[market/gex-positioning]", error);
    // Never throw to the client — degrade to the empty contract.
    return NextResponse.json(
      { available: false, ticker },
      { status: 200, headers: noStore }
    );
  }
}
