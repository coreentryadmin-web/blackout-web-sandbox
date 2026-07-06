// GET: returns the most recent regime snapshot — intentionally public (market-wide,
// no user-specific or paid-tier data; equivalent to the CDN-cached GEX endpoint).
// POST: stores a new regime snapshot (called by market-regime-detector cron)

import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { formatEtDate, mostRecentTradingDayEt } from "@/lib/nighthawk/session";
import { isEtCashRth } from "@/lib/et-market-hours";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
// Public GET: regime data is market-wide, not user-specific. 30s CDN TTL reduces
// DB load; POST writes are unaffected (no cache on mutations).
const CDN_CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=10" };

/**
 * `net_gex`/`iv_percentile` are Postgres NUMERIC columns (004_god_tier_features.sql);
 * node-postgres never parses NUMERIC to a JS `number` (avoids silent precision loss on
 * the driver side) — it comes back as a full-precision STRING (confirmed live:
 * "7730543991.5...93"), which was previously serialized verbatim into this route's
 * JSON response, unlike every other NUMERIC-sourced field this codebase serves (see
 * CLAUDE.md's "several endpoints serve unrounded floats" note; same class as the
 * gex-heatmap/gex-positioning fix, roundFloats). Coerce to a real number (preserving
 * SQL NULL as JSON null, never a false `0`) before rounding.
 */
function numericOrNull(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

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
    const now = new Date();

    // Staleness (task #173): this query is always "ORDER BY captured_at DESC LIMIT 1" —
    // on a healthy trading day that's a <5min-old row (market-regime-detector cron writes
    // every 5 min through isSpxEngineCronWindow), but off-hours, over a weekend/holiday, or
    // during a cron outage it's whatever the last successful write ever was, with nothing in
    // the response distinguishing "live" from "last one we ever captured, possibly days old."
    // Confirmed live: a Fri 2026-07-03 (July-4th-observed holiday) capture was still being
    // served `available: true` on Sun 2026-07-05, ~49h later, full playbook text included
    // (docs/audit/FINDINGS.md). `stale` is true whenever captured_at's ET calendar date isn't
    // the current/most-recently-completed trading session — an unparseable/missing timestamp
    // fails CLOSED (stale) rather than silently claiming freshness.
    const capturedAtMs = regime.captured_at ? new Date(regime.captured_at).getTime() : NaN;
    const stale = !Number.isFinite(capturedAtMs)
      ? true
      : formatEtDate(new Date(capturedAtMs)) !== mostRecentTradingDayEt(now);

    return NextResponse.json({
      available: true,
      regime: regime.composite,
      gexRegime: regime.gex_regime,
      volRegime: regime.vol_regime,
      trendRegime: regime.trend_regime,
      flowRegime: regime.flow_regime,
      playbook: regime.playbook,
      capturedAt: regime.captured_at,
      netGex: roundFloats(numericOrNull(regime.net_gex)),
      ivPercentile: roundFloats(numericOrNull(regime.iv_percentile)),
      aboveVwap: regime.above_vwap,
      // Additive fields (no existing field's meaning/type changed) — see PR for why
      // `available` stays true rather than flipping to false off-hours: there is no
      // known internal consumer of this route today (grepped; the Largo "get_market_regime"
      // tool reads a different source, fetchPlatformIntelSnapshot), so the non-breaking,
      // additive contract is the safer choice for any future/external consumer.
      stale,
      marketOpen: isEtCashRth(now),
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
    // Cron-only write path, but still don't forward raw exception text (Postgres driver/
    // constraint errors can embed internal detail) -- log server-side, return a fixed string.
    // Same pattern established in /api/ready (task #66).
    console.error("[market/regime] POST failed:", err);
    return NextResponse.json({ error: "Failed to store regime snapshot" }, { status: 500 });
  }
}
