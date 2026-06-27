import { NextRequest, NextResponse } from "next/server";
import { dbQuery, requireDatabaseInProduction } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Positions Expiry cron — runs daily at 5:30 PM ET after market close.
 * Finds any user_positions with status='open' whose expiry date has passed
 * and closes them automatically. Options don't trade after expiry, so leaving
 * them open clutters Night's Watch and wastes verdict engine cycles.
 *
 * Closes with closed_at = NOW(), notes appended with expiry reason.
 * Railway service: railway.positions-expiry.toml
 */
export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const res = await dbQuery<{ id: string; user_id: string; ticker: string; expiry: string }>(
      `UPDATE user_positions
       SET status     = 'closed',
           closed_at  = NOW(),
           updated_at = NOW(),
           notes      = COALESCE(notes || E'\n', '') || 'Auto-closed: option expired'
       WHERE status = 'open'
         AND expiry < (NOW() AT TIME ZONE 'America/New_York')::date
       RETURNING id, user_id, ticker, expiry::text`,
      []
    );

    const closed = res.rows.length;
    const payload = {
      ok: true,
      closed,
      positions: res.rows.map((r) => ({ id: r.id, user_id: r.user_id, ticker: r.ticker, expiry: r.expiry })),
    };
    await logCronRun("positions-expiry", started, payload);
    return NextResponse.json(payload);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[cron/positions-expiry]", detail);
    await logCronRun("positions-expiry", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
