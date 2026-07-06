import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApiForDeskCaller } from "@/lib/tool-access-server";
import { readGridCatalysts } from "@/lib/providers/grid";
import { fetchBenzingaCatalysts } from "@/lib/providers/polygon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache" };

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  const locked = await requireToolApiForDeskCaller(auth, "grid");
  if (locked) return locked;
  try {
    const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim() || undefined;

    // Per-ticker: direct Benzinga fetch — market-wide cache only stores 20 articles and
    // may not include recent ticker-specific catalysts.
    if (ticker) {
      const catalysts = await fetchBenzingaCatalysts(ticker, 15);
      const items = catalysts.map((c) => ({
        channel: c.channel,
        type: c.type,
        title: c.title,
        published: c.published,
        ticker,
        tickers: [ticker],
      }));
      return NextResponse.json(
        { available: true, as_of: new Date().toISOString(), items, ticker },
        { status: 200, headers: NO_STORE },
      );
    }

    // Market-wide: cache-reader path
    const snapshot = await readGridCatalysts();
    if (!snapshot) return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
    return NextResponse.json({ available: true, ...snapshot }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
  }
}
