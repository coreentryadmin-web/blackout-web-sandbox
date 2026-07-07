import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isSpxEngineCronWindow } from "@/features/spx/lib/spx-play-session-guards";
import { logCronRun } from "@/lib/cron-run";
import { runSpxIssuesSync } from "@/features/spx/lib/spx-issues-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SPX play/engine issue sync — computes the category:"play" (Claude arbiter veto,
 * gate blocks/warnings) and category:"engine" (play-engine heartbeat silent/stale)
 * issues admin-spx-issues.ts derives from live SpxPlayPayload state, and persists
 * them into admin_incidents via syncAdminIncidents (same pattern as
 * provider-health-reconcile / data-integrity).
 *
 * Previously this sync ONLY ran as a side effect of fetchSpxAdminDashboard(), i.e.
 * only when a human loaded /api/admin/spx/dashboard — there was no cron calling it,
 * so BIE's discovery layer (fetchDiscoveryIncidents in src/lib/bie/discovery.ts,
 * which reads admin_incidents to populate the member/admin "Open issues" panel) went
 * silently stale on SPX engine health whenever nobody happened to be viewing that
 * page. See docs/audit/FINDINGS.md for the full writeup. This route closes that gap
 * by running the same computation on a schedule, independent of any admin view.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isSpxEngineCronWindow()) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside SPX engine evaluation window (7:00–16:15 ET weekdays)",
    };
    await logCronRun("spx-issues-sync", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const issues = await runSpxIssuesSync();
    const payload = {
      ok: true,
      counts: issues.counts,
      health_ok: issues.health_ok,
      issues_synced: issues.issues.length,
    };
    await logCronRun("spx-issues-sync", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[spx-issues-sync]", detail);
    await logCronRun("spx-issues-sync", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "SPX issues sync failed" }, { status: 500 });
  }
}
