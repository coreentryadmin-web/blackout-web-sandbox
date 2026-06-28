import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // This endpoint returns raw signal_events rows — grade/ticker/strike/expiry/option_type/
  // entry_mark/confluence_score — i.e. the paid SPX_SLAYER + NIGHT_HAWK signal output. It is a
  // scoring helper for cron consumers ONLY, never a member-facing surface, so it must require the
  // shared CRON_SECRET. Without this gate it served 200 to any anonymous caller and leaked live
  // paid signals during RTH (deep-audit P1-B). Mirrors the sibling signal write routes.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Return all signal_events that have no EOD outcome checkpoint yet.
    // The signal-outcome-tracker cron uses this list to know what to score this cycle.
    const result = await dbQuery<{
      id: string;
      fired_at: string;
      signal_source: string;
      signal_type: string;
      grade: string | null;
      spx_price: string | null;
      call_wall: string | null;
      put_wall: string | null;
      confluence_score: string | null;
      ticker: string | null;
      strike: string | null;
      expiry: string | null;
      option_type: string | null;
      entry_mark: string | null;
      metadata: unknown;
    }>(
      `SELECT
         se.id,
         se.fired_at,
         se.signal_source,
         se.signal_type,
         se.grade,
         se.spx_price,
         se.call_wall,
         se.put_wall,
         se.confluence_score,
         se.ticker,
         se.strike,
         se.expiry,
         se.option_type,
         se.entry_mark,
         se.metadata
       FROM signal_events se
       WHERE NOT EXISTS (
         SELECT 1 FROM signal_outcomes so
         WHERE so.signal_event_id = se.id
           AND so.checkpoint = 'EOD'
       )
       ORDER BY se.fired_at DESC
       LIMIT 500`,
      []
    );

    return NextResponse.json({ ok: true, signals: result.rows });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[api/signals/open]", error);
    return NextResponse.json({ ok: false, error: "Failed to fetch open signals", detail, signals: [] });
  }
}
