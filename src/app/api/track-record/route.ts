import { NextRequest, NextResponse } from "next/server";
import { buildTrackRecordPagePayload } from "@/lib/track-record-page";
import { getClientIp, checkIpRateLimit, rateLimitHeaders } from "@/lib/ip-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// 60 req/min per IP: the /track-record page polls every ~30s while open, so
// two users sharing an IP (e.g., corporate NAT) need headroom. Still blocks scrapers.
const RATE_LIMIT = 60;
const RATE_WINDOW_SECS = 60;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkIpRateLimit(ip, "track-record", RATE_LIMIT, RATE_WINDOW_SECS);
  const rlHeaders = rateLimitHeaders(rl);

  if (!rl.ok) {
    return NextResponse.json(
      { available: false },
      { status: 429, headers: { ...NO_STORE, ...rlHeaders } }
    );
  }

  const payload = await buildTrackRecordPagePayload();
  if (payload.available === false) {
    return NextResponse.json({ available: false }, { headers: { ...NO_STORE, ...rlHeaders } });
  }
  return NextResponse.json(payload, { headers: { ...NO_STORE, ...rlHeaders } });
}
