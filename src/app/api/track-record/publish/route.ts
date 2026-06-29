import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  // Fail closed: if CRON_SECRET is unset this must reject, not become a public writer.
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
