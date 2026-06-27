import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { fetchPolygonPositioningBundle } from "@/lib/providers/polygon-options-gex";
import { analyzeStrikeGexRows, computeGammaFlip, gammaRegime } from "@/lib/providers/gamma-desk";

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

  // Shared-CDN cache headers for the success path. GEX matrix data is market-wide
  // (not per-user), so a short CDN TTL is safe. Auth check above already gates
  // entitlement; the response content itself is identical for all authorized callers.
  // stale-while-revalidate allows Cloudflare to serve a 5s stale copy while
  // refreshing in the background so latency never spikes at TTL expiry.
  const cdnCache = {
    "Cache-Control": "public, s-maxage=8, stale-while-revalidate=5",
  };

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
      // Primary cache-reader returned null (cold/empty matrix). Fall back to a direct
      // fetchPolygonPositioningBundle call so a temporary matrix gap never silently drops
      // the endpoint. This is best-effort: if the bundle also fails or is empty, we still
      // return the documented empty contract — never fabricated.
      console.warn("[market/gex-positioning] primary cache miss for", ticker, "— trying direct bundle fallback");
      try {
        const bundle = await fetchPolygonPositioningBundle(ticker);
        if (bundle.rows.length > 0) {
          const gexAnalysis = analyzeStrikeGexRows(bundle.rows);
          const flip = bundle.spot > 0 ? computeGammaFlip(gexAnalysis.ranked_levels, bundle.spot) : null;
          const regime = gammaRegime(bundle.spot, flip);
          // Build a minimal positioning-compatible response so callers get useful data.
          return NextResponse.json(
            {
              available: true,
              ticker,
              spot: bundle.spot,
              change_pct: 0,
              asof: new Date().toISOString(),
              flip,
              call_wall: null,
              put_wall: null,
              max_pain: bundle.maxPain,
              net_gex: gexAnalysis.net_gex,
              gamma_posture: gexAnalysis.net_gex >= 0 ? "long" : "short",
              gamma_regime_read: regime,
              net_vex: 0,
              vanna_posture: null,
              vanna_regime_read: "unavailable (fallback path)",
              net_dex: null,
              dex_posture: null,
              dex_regime_read: null,
              net_charm: null,
              charm_posture: null,
              charm_regime_read: null,
              nearest_wall: null,
              distance_to_flip_pct: flip != null && bundle.spot > 0
                ? Number((((bundle.spot - flip) / bundle.spot) * 100).toFixed(2))
                : null,
              shift_summary: null,
              source: "polygon" as const,
              _fallback: true,
            },
            { status: 200, headers: noStore }
          );
        }
      } catch (fbErr) {
        console.error("[market/gex-positioning] fallback bundle also failed:", fbErr);
      }
      return NextResponse.json(
        { available: false, ticker },
        { status: 200, headers: noStore }
      );
    }
    return NextResponse.json(
      { available: true, ...positioning },
      { status: 200, headers: cdnCache }
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
