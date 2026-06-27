import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  try {
    const result = await dbQuery(
      "SELECT * FROM platform_briefs WHERE brief_type = 'premarket' ORDER BY brief_date DESC LIMIT 1",
      []
    );
    if (result.rows.length === 0) return NextResponse.json({ available: false }, { headers: NO_STORE });
    const b = result.rows[0];
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
