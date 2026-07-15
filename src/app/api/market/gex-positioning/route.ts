import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireAnyToolApi } from "@/lib/tool-access-server";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { fetchPolygonPositioningBundle } from "@/lib/providers/polygon-options-gex";
import { analyzeStrikeGexRows, computeGammaFlip, gammaRegime, topGexWalls } from "@/lib/providers/gamma-desk";
import { roundFloats } from "@/lib/round-floats";
import { joinGexStrikeExpiryTicker } from "@/lib/ws/uw-socket";

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

  // Launch gate — this route returns the SAME dealer-positioning the Heat Maps tool shows. Allow
  // either tool's launch (or admin). Internal consumers call getGexPositioning() directly, so
  // nothing else is affected.
  const locked = await requireAnyToolApi(["spx", "heatmap"]);
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

  joinGexStrikeExpiryTicker(ticker);

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
          const walls = topGexWalls(gexAnalysis.ranked_levels, bundle.spot, 6);
          let call_wall: number | null = null;
          let put_wall: number | null = null;
          let posMax = -Infinity;
          let negMin = Infinity;
          for (const lv of gexAnalysis.ranked_levels) {
            if (lv.net_gex > posMax) {
              posMax = lv.net_gex;
              call_wall = lv.strike;
            }
            if (lv.net_gex < negMin) {
              negMin = lv.net_gex;
              put_wall = lv.strike;
            }
          }
          if (posMax <= 0) call_wall = null;
          if (negMin >= 0) put_wall = null;
          const nearest =
            walls.length > 0
              ? walls.reduce((best, w) =>
                  Math.abs(w.strike - bundle.spot) < Math.abs(best.strike - bundle.spot) ? w : best
                )
              : null;
          // Build a minimal positioning-compatible response so callers get useful data.
          return NextResponse.json(
            roundFloats({
              available: true,
              degraded: true,
              ticker,
              spot: bundle.spot,
              change_pct: 0,
              asof: new Date().toISOString(),
              flip,
              call_wall,
              put_wall,
              max_pain: bundle.maxPain,
              net_gex: gexAnalysis.net_gex,
              gamma_posture: flip != null && bundle.spot > 0 ? (bundle.spot >= flip ? "long" : "short") : null,
              gamma_regime_read: regime,
              net_vex: 0,
              vanna_posture: null,
              vanna_regime_read: "partial — single-expiry fallback (walls from chain band)",
              net_dex: null,
              dex_posture: null,
              dex_regime_read: null,
              net_charm: null,
              charm_posture: null,
              charm_regime_read: null,
              nearest_wall: nearest
                ? {
                    strike: nearest.strike,
                    kind: nearest.kind,
                    distance_pts: nearest.distance_pts,
                  }
                : null,
              distance_to_flip_pct: flip != null && bundle.spot > 0
                ? Number((((bundle.spot - flip) / bundle.spot) * 100).toFixed(2))
                : null,
              shift_summary: null,
              source: "polygon-fallback" as const,
              _fallback: true,
            }),
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
      roundFloats({ available: true, ...positioning }),
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
