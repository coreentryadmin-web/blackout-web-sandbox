import { NextRequest, NextResponse } from "next/server";
import { buildPublicTrackRecord } from "@/lib/track-record-public";
import { requireAdminApi } from "@/lib/admin-access";
import { getClientIp, checkIpRateLimit, rateLimitHeaders } from "@/lib/ip-rate-limit";
import { roundFloats } from "@/lib/round-floats";

// Admin-only aggregate ledger (formerly public embed API).
export const runtime = "nodejs";
// Must stay live with /api/market/spx/outcomes + /api/track-record — a 5m ISR cache
// caused split-brain when a play closed mid-RTH (public=7 vs outcomes=8).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// 30 requests per 60s per IP: generous for an embed widget (polls every 60-120s),
// but blocks automated scraping that would hammer this unauthenticated endpoint.
const RATE_LIMIT = 30;
const RATE_WINDOW_SECS = 60;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const ip = getClientIp(req);
  const rl = await checkIpRateLimit(ip, "public:track-record", RATE_LIMIT, RATE_WINDOW_SECS);
  const rlHeaders = rateLimitHeaders(rl);

  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { ...NO_STORE, ...rlHeaders } }
    );
  }

  const record = await buildPublicTrackRecord();
  return NextResponse.json(roundFloats(record), { headers: { ...NO_STORE, ...rlHeaders } });
}
