import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
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

  // Launch gate — this route returns the SAME dealer-positioning the locked Heatmaps tool shows, so
  // gate it to non-admins until Heatmaps ships (parity with gex-heatmap + explain). Verified: no
  // in-repo HTTP caller — internal consumers call getGexPositioning() directly, so nothing breaks.
  const locked = await requireToolApi("heatmap");
  if (locked) return locked;

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();

  const noStore = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

  // Validate BEFORE getGexPositioning — on a cache miss it triggers a paid spot/chain
  // fetch and mints a per-ticker cache key, so arbitrary input must be rejected up front
  // (mirrors the quote route guard).
  if (!/^[A-Z0-9.\-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: noStore });
  }

  // OPT-IN: the 0DTE intraday-adjusted lens (OI + volume model). Default OFF keeps this route the
  // documented LIGHT cache-reader; `?intraday=1` spends the bounded Trades tape + one gamma band.
  const wantIntraday = /^(1|true|yes)$/i.test(req.nextUrl.searchParams.get("intraday") ?? "");

  try {
    const positioning = await getGexPositioning(ticker, {
      includeIntradayAdjusted: wantIntraday,
    });
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
