import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Constant-time CRON_SECRET check; fail-closed when the secret is unset.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const b = await req.json();
    await dbQuery(
      `INSERT INTO platform_briefs (brief_date, brief_type, content, spx_price, call_wall, put_wall, king_strike, net_gex, gex_bias, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (brief_date, brief_type) DO UPDATE SET
         content = EXCLUDED.content,
         spx_price = EXCLUDED.spx_price,
         call_wall = EXCLUDED.call_wall,
         put_wall = EXCLUDED.put_wall,
         king_strike = EXCLUDED.king_strike,
         net_gex = EXCLUDED.net_gex,
         gex_bias = EXCLUDED.gex_bias,
         metadata = EXCLUDED.metadata,
         published_at = NOW()`,
      [b.date, b.type, b.content, b.spxPrice, b.callWall, b.putWall, b.kingStrike, b.netGex, b.gexBias, JSON.stringify(b)]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Cron-only write path, but still don't forward raw exception text (Postgres driver/
    // constraint errors can embed internal detail) -- log server-side, return a fixed string.
    // Same pattern established in /api/ready (task #66).
    console.error("[brief/store] POST failed:", err);
    return NextResponse.json({ error: "Failed to store brief" }, { status: 500 });
  }
}
