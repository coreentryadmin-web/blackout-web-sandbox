import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApiForDeskCaller } from "@/lib/tool-access-server";
import { polygonConfigured } from "@/lib/providers/config";
import { readGridAnalysts, classifyAnalystAction } from "@/lib/providers/grid";
import { fetchBenzingaNews } from "@/lib/providers/polygon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/grid/analysts — Analyst Actions panel (BlackOut Grid).
 *
 * CACHE-READER: reads the `grid:analysts` Redis snapshot written by the `grid-warm` cron
 * (market-wide Benzinga analyst channel). On a cold cache it falls through to ONE deduped
 * upstream fetch via readGridAnalysts (uwCacheGet single-flight) — never a per-request stampede.
 *
 * GATED to `grid` (parity with gex-positioning): non-admins get the lock response until the Grid
 * ships. Returns { available:false } (200) on a cold/empty cache — never fabricated, never throws.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApiForDeskCaller(auth, "grid");
  if (locked) return locked;

  const noStore = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

  if (!polygonConfigured()) {
    return NextResponse.json({ available: false }, { status: 200, headers: noStore });
  }

  try {
    const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim() || undefined;

    // Per-ticker: fetch all Benzinga articles for the ticker (tickers.any_of=TICKER), then
    // filter locally for analyst-type actions. Using the combined tickers+channels filter on
    // the Massive API backend returns 0 results — the channel filter breaks the ticker filter.
    // Fetching broadly and filtering on action type locally is more reliable.
    if (ticker) {
      const articles = await fetchBenzingaNews(50, { ticker });
      const actions = articles
        .map((a) => ({
          id: a.id,
          title: a.title,
          action: classifyAnalystAction(a.title, a.channels),
          tickers: a.tickers.slice(0, 6),
          published: a.published,
          url: a.url,
        }))
        .filter((a) => a.action !== "other");
      return NextResponse.json(
        { available: true, as_of: new Date().toISOString(), actions, ticker },
        { status: 200, headers: noStore },
      );
    }

    // Market-wide: cache-reader path
    const snapshot = await readGridAnalysts();
    if (!snapshot) {
      return NextResponse.json({ available: false }, { status: 200, headers: noStore });
    }
    return NextResponse.json({ available: true, ...snapshot }, { status: 200, headers: noStore });
  } catch (error) {
    console.error("[grid/analysts]", error);
    return NextResponse.json({ available: false }, { status: 200, headers: noStore });
  }
}
