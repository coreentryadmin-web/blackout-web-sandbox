import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  try {
    const result = await dbQuery(
      "SELECT * FROM coaching_alerts ORDER BY generated_at DESC LIMIT 10",
      []
    );
    return NextResponse.json({
      alerts: result.rows.map(r => ({
        id: r.id,
        generatedAt: r.generated_at,
        trigger: r.trigger_type,
        alert: r.alert_text,
        urgency: r.urgency,
        spxPrice: r.spx_price,
        callWall: r.call_wall,
        putWall: r.put_wall,
        vwap: r.vwap,
        forLongs: r.for_longs,
        forShorts: r.for_shorts,
      }))
    }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ alerts: [] }, { status: 200, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { alerts, spxPrice, callWall, putWall, vwap } = body;
    if (!Array.isArray(alerts) || alerts.length === 0) return NextResponse.json({ ok: true });
    await Promise.all(alerts.map((a: { trigger: string; alert: string; urgency: string; for_longs?: boolean; for_shorts?: boolean }) =>
      dbQuery(
        `INSERT INTO coaching_alerts (trigger_type, alert_text, urgency, spx_price, call_wall, put_wall, vwap, for_longs, for_shorts, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [a.trigger, a.alert, a.urgency, spxPrice, callWall, putWall, vwap, a.for_longs ?? true, a.for_shorts ?? false, JSON.stringify(a)]
      )
    ));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
