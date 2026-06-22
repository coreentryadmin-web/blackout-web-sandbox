import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";
import { logCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";

/**
 * Cron staleness watchdog.
 *
 * Per-run failure alerts (cron-run.ts) only fire when a route actually executes and
 * returns ok:false. They CANNOT catch the silent-death case: a cron that never fires
 * (401 from a rotated CRON_SECRET, a dropped/misconfigured Railway schedule, a deleted
 * service) writes no row at all — so nothing alerts. This watchdog closes that gap by
 * periodically reading the health snapshot and pinging Discord when any job is stale or
 * failed. It is deliberately a separate service so it can detect the others going dark.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await buildCronHealthSnapshot();
    // Alert on jobs that were expected to run but are overdue (stale) or errored (failed).
    // "unknown" (never logged) is excluded — it's the normal state for window-guarded jobs
    // before their first run of the day and would create off-hours noise.
    const problems = snapshot.jobs.filter(
      (j) => j.status === "stale" || j.status === "failed"
    );

    if (problems.length > 0) {
      const lines = problems
        .map((j) => `• **${j.name}** (\`${j.key}\`) — ${j.status}: ${j.status_label}`)
        .join("\n");
      await notifyOpsDiscord({
        title: `⚠️ Cron health: ${problems.length} job(s) need attention`,
        body: lines,
        severity: "critical",
      }).catch(() => undefined);
    }

    const result = {
      ok: true,
      checked: snapshot.jobs.length,
      problems: problems.length,
      problem_keys: problems.map((j) => j.key),
    };
    await logCronRun("cron-staleness-watchdog", started, result);
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/cron-staleness-watchdog]", error);
    await logCronRun("cron-staleness-watchdog", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
