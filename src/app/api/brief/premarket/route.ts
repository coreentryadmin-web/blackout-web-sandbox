import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { isPremarketBriefFresh, todayEtYmd } from "@/lib/providers/spx-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(req: NextRequest) {
  // Premium premarket brief (SPX levels, kingStrike, netGex, gexBias) — premium session or cron only.
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  try {
    const result = await dbQuery(
      "SELECT * FROM platform_briefs WHERE brief_type = 'premarket' ORDER BY brief_date DESC LIMIT 1",
      []
    );
    if (result.rows.length === 0) return NextResponse.json({ available: false }, { headers: NO_STORE });
    const b = result.rows[0];
    // pg returns DATE columns as a Date object (midnight UTC) or, depending on driver config,
    // an already-ISO string — normalize both to a plain YYYY-MM-DD before comparing.
    const briefDateYmd =
      b.brief_date instanceof Date
        ? b.brief_date.toISOString().slice(0, 10)
        : String(b.brief_date).slice(0, 10);
    if (!isPremarketBriefFresh(briefDateYmd, todayEtYmd())) {
      return NextResponse.json(
        { available: false, stale: true, staleDate: briefDateYmd },
        { headers: NO_STORE }
      );
    }
    return NextResponse.json({
      available: true,
      date: b.brief_date,
      content: b.content,
      spxPrice: b.spx_price,
      callWall: b.call_wall,
      putWall: b.put_wall,
      kingStrike: b.king_strike,
      netGex: b.net_gex,
      gexBias: b.gex_bias,
      publishedAt: b.published_at,
    }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ available: false }, { headers: NO_STORE });
  }
}
