import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  try {
    const result = await dbQuery(
      "SELECT * FROM flow_anomalies ORDER BY detected_at DESC LIMIT 20",
      []
    );
    return NextResponse.json({
      anomalies: result.rows.map(r => ({
        id: r.id,
        detectedAt: r.detected_at,
        type: r.anomaly_type,
        ticker: r.ticker,
        detail: r.detail,
        premium: r.premium,
        direction: r.direction,
        severity: r.severity,
      }))
    }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ anomalies: [] }, { status: 200, headers: NO_STORE });
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
    const { anomalies } = body;
    if (!Array.isArray(anomalies) || anomalies.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }
    await Promise.all(anomalies.map((a: { type: string; ticker?: string; detail: string; premium?: number; direction?: string; severity: string }) =>
      dbQuery(
        `INSERT INTO flow_anomalies (anomaly_type, ticker, detail, premium, direction, severity, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [a.type, a.ticker, a.detail, a.premium, a.direction, a.severity, JSON.stringify(a)]
      )
    ));
    return NextResponse.json({ ok: true, inserted: anomalies.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
