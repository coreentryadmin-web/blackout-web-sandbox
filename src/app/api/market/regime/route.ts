// GET: returns the most recent regime snapshot — intentionally public (market-wide,
// no user-specific or paid-tier data; equivalent to the CDN-cached GEX endpoint).
// POST: stores a new regime snapshot (called by market-regime-detector cron)

import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
// Public GET: regime data is market-wide, not user-specific. 30s CDN TTL reduces
// DB load; POST writes are unaffected (no cache on mutations).
const CDN_CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=10" };

export async function GET() {
  try {
    const result = await dbQuery(
      "SELECT * FROM market_regime ORDER BY captured_at DESC LIMIT 1",
      []
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
    }
    const regime = result.rows[0];
    return NextResponse.json({
      available: true,
      regime: regime.composite,
      gexRegime: regime.gex_regime,
      volRegime: regime.vol_regime,
      trendRegime: regime.trend_regime,
      flowRegime: regime.flow_regime,
      playbook: regime.playbook,
      capturedAt: regime.captured_at,
      netGex: regime.net_gex,
      ivPercentile: regime.iv_percentile,
      aboveVwap: regime.above_vwap,
    }, { status: 200, headers: CDN_CACHE });
  } catch {
    return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  // Constant-time CRON_SECRET check for cron writes; fail-closed when the secret is unset.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    await dbQuery(
      `INSERT INTO market_regime (gex_regime, vol_regime, trend_regime, flow_regime, composite, playbook, net_gex, iv_percentile, above_vwap, flow_ratio, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [body.gex_regime, body.vol_regime, body.trend_regime, body.flow_regime,
       body.composite, body.playbook, body.net_gex, body.iv_percentile,
       body.above_vwap, body.flow_ratio, JSON.stringify(body)]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
