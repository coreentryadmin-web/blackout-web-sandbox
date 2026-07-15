// POST /api/admin/zerodte/regrade-index-roots — the P-6 backfill (one-shot, re-runnable).
//
// Historical index-root ledger rows (SPXW/SPX/NDX/…) were stamped `graded` with
// permanent null grades by the pre-polygonSpotTicker bug (see zerodte/regrade.ts's
// module doc for the exact signature). This route clears `graded_at` on EXACTLY those
// rows so the existing lazy grader re-grades them through the fixed mapping, then runs
// bounded grading passes itself so a single call normally finishes the job instead of
// waiting on the next cron tick.
//
// Contract: idempotent (a cleared row can never match the selector again), bounded
// (limit param, hard cap), dry-run-able, and every run logs its row counts to the
// console AND admin_audit_log (this is an admin ACTION, unlike the read-only
// admin/zerodte/health — see that route's comment on the distinction).
//
// Body (all optional): { "dry_run": true, "limit": 200 }
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiActor, requireAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { resetNullGradedZeroDteRows } from "@/lib/db";
import { todayEt } from "@/features/nighthawk/lib/session";
import { INDEX_OPTION_ROOTS } from "@/lib/zerodte/board";
import { gradeZeroDteLedger } from "@/lib/zerodte/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
// gradeZeroDteLedger processes ≤12 ungraded rows per pass (its own fetch cap) —
// bound the drain loop by the cleared count so a row that STILL can't grade
// (e.g. Polygon has no bar for that date) can never spin this route forever.
const GRADER_BATCH = 12;

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  const actor = await getAdminApiActor();

  let dryRun = false;
  let limit = DEFAULT_LIMIT;
  try {
    // Empty body is a valid "run with defaults" — only reject malformed JSON that
    // was actually sent.
    const raw = await req.text();
    if (raw.trim().length > 0) {
      const body = JSON.parse(raw) as { dry_run?: unknown; limit?: unknown };
      dryRun = body.dry_run === true;
      if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
        limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(body.limit)));
      }
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const today = todayEt();
    const { rows, cleared } = await resetNullGradedZeroDteRows({
      tickers: INDEX_OPTION_ROOTS,
      beforeDate: today,
      limit,
      dryRun,
    });

    // Drain the re-grade immediately (best-effort): force=true bypasses the lazy
    // throttle; passes are bounded by what we just cleared, and we stop early the
    // moment a pass grades nothing. A row whose session genuinely has no index bar
    // (e.g. I:SPX published none for 2026-07-03) re-grades to a null close again —
    // it will re-match this selector on a future run, which is honest (it IS the
    // null-grade signature) and harmless: this route is admin-invoked and bounded,
    // and such rows are visible in the returned `rows` list either way.
    let regraded = 0;
    if (!dryRun && cleared > 0) {
      const maxPasses = Math.ceil(cleared / GRADER_BATCH);
      for (let pass = 0; pass < maxPasses; pass++) {
        const graded = await gradeZeroDteLedger(true).catch(() => 0);
        regraded += graded;
        if (graded === 0) break;
      }
    }

    const summary = {
      ok: true as const,
      dry_run: dryRun,
      matched: rows.length,
      cleared,
      regraded,
      rows,
    };
    console.info(
      `[zerodte-regrade] dry_run=${dryRun} matched=${rows.length} cleared=${cleared} regraded=${regraded}`
    );
    void logAdminAction({
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      action: "zerodte_regrade_index_roots",
      detail: { dry_run: dryRun, limit, matched: rows.length, cleared, regraded },
    });
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    recordAdminRouteError("admin/zerodte/regrade-index-roots", error);
    return NextResponse.json(
      { ok: false, error: "Regrade backfill failed" },
      { status: 502 }
    );
  }
}
