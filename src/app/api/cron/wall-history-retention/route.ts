import { NextRequest, NextResponse } from "next/server";
import { dbQuery, requireDatabaseInProduction } from "@/lib/db";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";
import {
  wallHistoryRetentionDays,
  buildWallHistoryDeleteQuery,
  WALL_HISTORY_DELETE_BATCH,
} from "@/lib/wall-history-retention";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Loop bound: MAX_BATCHES * WALL_HISTORY_DELETE_BATCH = 50M rows/run ceiling. This is a
// safety stop, never hit in practice (a day's arrears is far smaller) — it just guarantees
// the batched-delete loop terminates even if rowCount ever misbehaves.
const MAX_BATCHES = 10_000;

/**
 * Daily wall-history retention — prunes `vector_wall_history` rows older than
 * WALL_HISTORY_RETENTION_DAYS (default 30d staging; prod sets 90d). Bounded (batched by
 * ctid), idempotent (a re-run deletes nothing new), cron-authorized, and fail-soft: a
 * DB error logs a failed cron run and returns 500 but never throws past the handler.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = wallHistoryRetentionDays();

  try {
    let deleted = 0;
    let batches = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { text, values } = buildWallHistoryDeleteQuery(days);
      const res = await dbQuery(text, values);
      const n = res.rowCount ?? 0;
      deleted += n;
      batches++;
      // A short batch means we've drained the eligible rows — stop.
      if (n < WALL_HISTORY_DELETE_BATCH) break;
    }
    const payload = { ok: true, retention_days: days, deleted, batches };
    await logCronRun("wall-history-retention", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    // 42P01 = undefined_table: the wall-history writer hasn't created the table yet. There's
    // nothing to prune and this must NOT page as a failure — record a skip and return 200.
    if ((error as { code?: string } | null)?.code === "42P01") {
      const payload = {
        ok: true,
        skipped: true,
        reason: "vector_wall_history not created yet (no rows to prune)",
        retention_days: days,
        deleted: 0,
      };
      await logCronRun("wall-history-retention", started, payload);
      return NextResponse.json(payload);
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/wall-history-retention]", error);
    await logCronRun("wall-history-retention", started, { ok: false, error: detail });
    return NextResponse.json(
      { ok: false, error: "Wall-history retention failed", detail },
      { status: 500 },
    );
  }
}
