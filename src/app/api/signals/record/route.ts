import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      signal_source,
      signal_type,
      grade,
      spx_price,
      call_wall,
      put_wall,
      confluence_score,
      ticker,
      strike,
      expiry,
      option_type,
      entry_mark,
      metadata,
    } = body;

    if (!signal_source || !signal_type) {
      return NextResponse.json(
        { ok: false, error: "signal_source and signal_type are required" },
        { status: 400 }
      );
    }

    const result = await dbQuery<{ id: string; fired_at: string }>(
      `INSERT INTO signal_events
         (signal_source, signal_type, grade, spx_price, call_wall, put_wall,
          confluence_score, ticker, strike, expiry, option_type, entry_mark, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, fired_at`,
      [
        signal_source,
        signal_type,
        grade ?? null,
        spx_price ?? null,
        call_wall ?? null,
        put_wall ?? null,
        confluence_score ?? null,
        ticker ?? null,
        strike ?? null,
        expiry ?? null,
        option_type ?? null,
        entry_mark ?? null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    const row = result.rows[0];
    return NextResponse.json({ ok: true, id: row.id, fired_at: row.fired_at });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[api/signals/record]", error);
    return NextResponse.json({ ok: false, error: "Failed to record signal", detail });
  }
}
