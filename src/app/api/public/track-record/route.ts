import { NextResponse } from "next/server";
import { buildPublicTrackRecord } from "@/lib/track-record-public";

// PUBLIC route by design: it intentionally calls NONE of the self-guard helpers
// (requireTierApi / authorizeMarketDeskApi / isCronAuthorized). See the security
// contract in src/middleware.ts — public-ness is an explicit per-handler choice.
// Output is the sanitized, PII-free aggregate from buildPublicTrackRecord().
export const runtime = "nodejs";
// Must stay live with /api/market/spx/outcomes + /api/track-record — a 5m ISR cache
// caused split-brain when a play closed mid-RTH (public=7 vs outcomes=8).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  const record = await buildPublicTrackRecord();
  return NextResponse.json(record, { headers: NO_STORE });
}
