import { NextRequest, NextResponse } from "next/server";
import { buildPublicTrackRecord } from "@/lib/track-record-public";
import { getClientIp, checkIpRateLimit, rateLimitHeaders } from "@/lib/ip-rate-limit";

// PUBLIC route by design: it intentionally calls NONE of the self-guard helpers
// (requireTierApi / authorizeMarketDeskApi / isCronAuthorized). See the security
// contract in src/middleware.ts — public-ness is an explicit per-handler choice.
// Output is the sanitized, PII-free aggregate from buildPublicTrackRecord().
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
  return NextResponse.json(record, { headers: { ...NO_STORE, ...rlHeaders } });
}
