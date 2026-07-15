// POST /api/admin/nighthawk/regrade-stuck-outcomes — the Night Hawk historical repairs
// (one-shot, re-runnable). Mirrors admin/zerodte/regrade-index-roots.
//
// Two modes, selected by body.mode:
//  - "stuck" (default; PR-N1): rows stuck `pending` beyond the outcomes cron's 7-day
//    lookback (the H-1 constraint clobber left 12 of them — see regrade-stuck.ts's module
//    doc) are re-resolved through the SAME grading path the cron uses, now that
//    ensureSchema no longer strips 'unfilled' from the outcome CHECK.
//  - "legacy_methodology" (PR-N2): resolved rows still carrying a pre-fillability grade
//    (grade_methodology ≠ current) are re-graded under the CURRENT resolveOutcome from
//    their own persisted bars, with the superseded grade preserved in legacy_grade and
//    the row promoted to the current methodology tag — see regrade-legacy.ts's module
//    doc for the phantom-win numbers that motivated it.
//
// Both are bounded (limit, hard cap), idempotent (a processed row can never match its
// selector again), dry-runnable, and every run logs its counts to the console AND
// admin_audit_log (this is an admin ACTION, not a read).
//
// Body (all optional): { "mode": "stuck" | "legacy_methodology", "dry_run": true,
//                        "limit": 50, "search_window_days": 90 }
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiActor, requireAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import {
  regradeStuckNighthawkOutcomes,
  DEFAULT_LIMIT,
  DEFAULT_SEARCH_WINDOW_DAYS,
} from "@/features/nighthawk/lib/regrade-stuck";
import { regradeLegacyNighthawkOutcomes } from "@/features/nighthawk/lib/regrade-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  const actor = await getAdminApiActor();

  let mode: "stuck" | "legacy_methodology" = "stuck";
  let dryRun = false;
  let limit = DEFAULT_LIMIT;
  let searchWindowDays = DEFAULT_SEARCH_WINDOW_DAYS;
  try {
    // Empty body is a valid "run with defaults" — only reject malformed JSON that
    // was actually sent. (Same convention as the zerodte regrade route.)
    const raw = await req.text();
    if (raw.trim().length > 0) {
      const body = JSON.parse(raw) as {
        mode?: unknown;
        dry_run?: unknown;
        limit?: unknown;
        search_window_days?: unknown;
      };
      if (body.mode === "legacy_methodology") {
        mode = "legacy_methodology";
      } else if (body.mode !== undefined && body.mode !== "stuck") {
        return NextResponse.json(
          { ok: false, error: `Unknown mode — expected "stuck" or "legacy_methodology"` },
          { status: 400 }
        );
      }
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
    if (mode === "legacy_methodology") {
      const result = await regradeLegacyNighthawkOutcomes({ dryRun, limit, searchWindowDays });
      // Same errors-with-content-is-not-ok rule as the stuck mode below.
      const summary = { ok: result.errors.length === 0, mode, ...result };
      console.info(
        `[nighthawk-regrade-legacy] dry_run=${result.dry_run} matched=${result.matched} ` +
          `regraded=${result.regraded} skipped_unresolvable=${result.skipped_unresolvable} ` +
          `errors=${result.errors.length}`
      );
      void logAdminAction({
        actorUserId: actor?.userId,
        actorEmail: actor?.email,
        action: "nighthawk_regrade_legacy_methodology",
        detail: {
          dry_run: result.dry_run,
          limit,
          search_window_days: searchWindowDays,
          methodology: result.methodology,
          matched: result.matched,
          regraded: result.regraded,
          skipped_unresolvable: result.skipped_unresolvable,
          errors: result.errors,
          // previous→current per row, so the audit log itself carries the evidence
          // trail of every grade the honest re-grade changed (the phantom wins).
          outcomes: result.rows.map(
            (r) => `${r.ticker}@${r.edition_for}:${r.previous_outcome}→${r.outcome}`
          ),
        },
      });
      return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await regradeStuckNighthawkOutcomes({ dryRun, limit, searchWindowDays });

    // Per-row errors are a partial failure, not a 502 — the caller gets the full
    // ledger of what did/didn't grade and `ok` reflects it honestly (same
    // errors-with-content-is-not-ok rule the outcomes cron now follows).
    const summary = {
      ok: result.errors.length === 0,
      mode,
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
      { ok: false, error: "Outcome regrade failed" },
      { status: 502 }
    );
  }
}
