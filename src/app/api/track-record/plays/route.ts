import { NextRequest, NextResponse } from "next/server";
import {
  dbConfigured,
  fetchClosedPlayOutcomes,
  fetchNighthawkOutcomeAnalytics,
} from "@/lib/db";
import { serverCache, TTL } from "@/lib/server-cache";
import { isNighthawkOutcomeScoreable } from "@/lib/track-record-page";
import { requireAdminApi } from "@/lib/admin-access";
import { getClientIp, checkIpRateLimit, rateLimitHeaders } from "@/lib/ip-rate-limit";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only per-play audit trail for /admin/track-record.
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
const SPX_LIMIT = 200;
const NH_WINDOW_DAYS = 90;
// 10 req/min: loaded once on expand (lazy), not polled — generous enough for re-opens.
const RATE_LIMIT = 10;
const RATE_WINDOW_SECS = 60;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const ip = getClientIp(req);
  const rl = await checkIpRateLimit(ip, "track-record:plays", RATE_LIMIT, RATE_WINDOW_SECS);
  const rlHeaders = rateLimitHeaders(rl);

  if (!rl.ok) {
    return NextResponse.json({ available: false }, { status: 429, headers: { ...NO_STORE, ...rlHeaders } });
  }

  if (!dbConfigured()) {
    return NextResponse.json({ available: false }, { headers: { ...NO_STORE, ...rlHeaders } });
  }
  try {
    const payload = await serverCache("track-record:plays", TTL.REFERENCE, async () => {
      const [spxRows, nhResult] = await Promise.all([
        fetchClosedPlayOutcomes(SPX_LIMIT),
        fetchNighthawkOutcomeAnalytics(NH_WINDOW_DAYS),
      ]);
      return {
        available: true,
        spx: spxRows.map((r) => ({
          id: r.id,
          session_date: r.session_date,
          direction: r.direction,
          grade: r.grade,
          entry_price: r.entry_price,
          exit_price: r.exit_price,
          pnl_pts: r.pnl_pts,
          outcome: r.outcome,
          exit_action: r.exit_action,
          closed_at: r.closed_at,
        })),
        nighthawk: nhResult.rows.filter(isNighthawkOutcomeScoreable).map((r) => ({
          id: r.id,
          edition_for: r.edition_for,
          ticker: r.ticker,
          direction: r.direction,
          conviction: r.conviction,
          outcome: r.outcome,
          entry_range_low: r.entry_range_low,
          entry_range_high: r.entry_range_high,
          target: r.target,
          stop: r.stop,
          next_day_close: r.next_day_close,
        })),
      };
    });
    return NextResponse.json(roundFloats(payload), { headers: { ...NO_STORE, ...rlHeaders } });
  } catch {
    return NextResponse.json({ available: false }, { status: 503, headers: { ...NO_STORE, ...rlHeaders } });
  }
}
