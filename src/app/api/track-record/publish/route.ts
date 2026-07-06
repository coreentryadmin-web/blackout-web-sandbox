import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Constant-time CRON_SECRET check; fail-closed when the secret is unset.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    // Store snapshot as a premarket brief type 'track_record'
    await dbQuery(
      `INSERT INTO platform_briefs (brief_date, brief_type, content, metadata)
       VALUES (CURRENT_DATE, 'track_record', $1, $2)
       ON CONFLICT (brief_date, brief_type) DO UPDATE SET
         content = EXCLUDED.content, metadata = EXCLUDED.metadata, published_at = NOW()`,
      [JSON.stringify(body), JSON.stringify(body)]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Cron-only write path, but still don't forward raw exception text (Postgres driver/
    // constraint errors can embed internal detail) -- log server-side, return a fixed string.
    // Same pattern established in /api/ready (task #66).
    console.error("[track-record/publish] POST failed:", err);
    return NextResponse.json({ error: "Failed to publish track record" }, { status: 500 });
  }
}
