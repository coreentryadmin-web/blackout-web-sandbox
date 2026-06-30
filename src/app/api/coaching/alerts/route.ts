import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authorizeMarketDeskApi, isCronAuthorized } from "@/lib/market-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(req: NextRequest) {
  // Paid SPX coaching (live walls/VWAP + long/short calls) — premium session or cron only.
  const authResult = await authorizeMarketDeskApi(req);
  if (authResult instanceof Response) return authResult;
  try {
    const result = await dbQuery(
      "SELECT * FROM coaching_alerts ORDER BY generated_at DESC LIMIT 10",
      []
    );
    const now = Date.now();
    return NextResponse.json({
      alerts: result.rows.map(r => {
        const generatedAt = r.generated_at;
        const ageMs = generatedAt ? now - new Date(generatedAt).getTime() : null;
        return {
          id: r.id,
          generatedAt,
          age_minutes: ageMs != null ? Math.floor(ageMs / 60_000) : null,
          stale: ageMs != null ? ageMs > 60 * 60 * 1000 : false,
          trigger: r.trigger_type,
          alert: r.alert_text,
          urgency: r.urgency,
          spxPrice: r.spx_price,
          callWall: r.call_wall,
          putWall: r.put_wall,
          vwap: r.vwap,
          forLongs: r.for_longs,
          forShorts: r.for_shorts,
        };
      })
    }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ alerts: [] }, { status: 200, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  // Constant-time CRON_SECRET check; fail-closed when the secret is unset.
  if (!isCronAuthorized(req)) {
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
