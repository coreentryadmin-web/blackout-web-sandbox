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
      signal_event_id,
      checkpoint,
      price_at_checkpoint,
      price_change,
      direction_correct,
      pnl_pct,
      outcome,
      regime_at_fire,
      regime_at_check,
    } = body;

    if (!signal_event_id || !checkpoint) {
      return NextResponse.json(
        { ok: false, error: "signal_event_id and checkpoint are required" },
        { status: 400 }
      );
    }

    // Build metadata JSONB for regime fields (not native columns on signal_outcomes)
    const meta: Record<string, unknown> = {};
    if (regime_at_fire !== undefined) meta.regime_at_fire = regime_at_fire;
    if (regime_at_check !== undefined) meta.regime_at_check = regime_at_check;

    const insertResult = await dbQuery<{ id: string; recorded_at: string }>(
      `INSERT INTO signal_outcomes
         (signal_event_id, checkpoint, price_at_checkpoint, price_change,
          direction_correct, pnl_pct, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id, recorded_at`,
      [
        signal_event_id,
        checkpoint,
        price_at_checkpoint ?? null,
        price_change ?? null,
        direction_correct ?? null,
        pnl_pct ?? null,
        outcome ?? "OPEN",
      ]
    );

    const row = insertResult.rows[0] ?? null;

    // On EOD checkpoint: the signal is now fully scored — no additional
    // column needed because open/route.ts excludes events that have an EOD row.
    // Nothing else to update; the query in /open handles closure via NOT EXISTS.

    return NextResponse.json({
      ok: true,
      id: row?.id ?? null,
      recorded_at: row?.recorded_at ?? null,
      closed: checkpoint === "EOD",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[api/signals/outcome]", error);
    return NextResponse.json({ ok: false, error: "Failed to record outcome", detail });
  }
}
