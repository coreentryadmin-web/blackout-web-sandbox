import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  // Fail closed: if CRON_SECRET is unset this must reject, not become a public writer.
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
