// POST /api/admin/nighthawk/regrade-stuck-outcomes — the PR-N1 historical repair
// (one-shot, re-runnable). Mirrors admin/zerodte/regrade-index-roots.
//
// Rows stuck `pending` beyond the outcomes cron's 7-day lookback (the H-1 constraint
// clobber left 12 of them — see regrade-stuck.ts's module doc for the full wound) are
// re-resolved through the SAME grading path the cron uses, now that ensureSchema no
// longer strips 'unfilled' from the outcome CHECK. Bounded (limit, hard cap),
// idempotent (a graded row can never match the selector again), dry-runnable, and
// every run logs its counts to the console AND admin_audit_log (this is an admin
// ACTION, not a read).
//
// Body (all optional): { "dry_run": true, "limit": 50, "search_window_days": 90 }
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiActor, requireAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import {
  regradeStuckNighthawkOutcomes,
  DEFAULT_LIMIT,
  DEFAULT_SEARCH_WINDOW_DAYS,
} from "@/features/nighthawk/lib/regrade-stuck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  const actor = await getAdminApiActor();

  let dryRun = false;
  let limit = DEFAULT_LIMIT;
  let searchWindowDays = DEFAULT_SEARCH_WINDOW_DAYS;
  try {
    // Empty body is a valid "run with defaults" — only reject malformed JSON that
    // was actually sent. (Same convention as the zerodte regrade route.)
    const raw = await req.text();
    if (raw.trim().length > 0) {
      const body = JSON.parse(raw) as {
        dry_run?: unknown;
        limit?: unknown;
        search_window_days?: unknown;
      };
      dryRun = body.dry_run === true;
      if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
        limit = body.limit;
      }
      if (typeof body.search_window_days === "number" && Number.isFinite(body.search_window_days)) {
        searchWindowDays = body.search_window_days;
      }
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await regradeStuckNighthawkOutcomes({ dryRun, limit, searchWindowDays });

    // Per-row errors are a partial failure, not a 502 — the caller gets the full
    // ledger of what did/didn't grade and `ok` reflects it honestly (same
    // errors-with-content-is-not-ok rule the outcomes cron now follows).
    const summary = {
      ok: result.errors.length === 0,
      ...result,
    };
    console.info(
      `[nighthawk-regrade-stuck] dry_run=${result.dry_run} matched=${result.matched} ` +
        `regraded=${result.regraded} skipped_no_bar=${result.skipped_no_bar} errors=${result.errors.length}`
    );
    void logAdminAction({
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      action: "nighthawk_regrade_stuck_outcomes",
      detail: {
        dry_run: result.dry_run,
        limit,
        search_window_days: searchWindowDays,
        matched: result.matched,
        regraded: result.regraded,
        skipped_no_bar: result.skipped_no_bar,
        errors: result.errors,
        outcomes: result.rows.map((r) => `${r.ticker}@${r.edition_for}:${r.outcome}`),
      },
    });
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/regrade-stuck-outcomes", error);
    return NextResponse.json(
      { ok: false, error: "Stuck-outcome regrade failed" },
      { status: 502 }
    );
  }
}
