import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";
import { logCronRun } from "@/lib/cron-run";
import { dispatchCronWarm, isDispatchableCron } from "@/lib/cron-dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron staleness watchdog.
 *
 * Per-run failure alerts (cron-run.ts) only fire when a route actually executes and
 * returns ok:false. They CANNOT catch the silent-death case: a cron that never fires
 * (401 from a rotated CRON_SECRET, a dropped/misconfigured Railway schedule, a deleted
 * service) writes no row at all — so nothing alerts. This watchdog closes that gap by
 * periodically reading the health snapshot and pinging Discord when any job is stale or
 * failed. It is deliberately a separate service so it can detect the others going dark.
 *
 * The #90 outage (live-data warmers died ~3 days, nothing alerted) hardened three things:
 *   (a) market-hours jobs that are stale DURING RTH are escalated and called out FIRST, and
 *       if the alert can't be delivered (no webhook configured) we log it LOUD rather than
 *       silently dropping it;
 *   (b) optional SELF-HEAL (env CRON_WATCHDOG_SELF_HEAL=1): re-warm stale, safe+idempotent
 *       crons via the shared dispatch instead of only alerting;
 *   (c) the admin UI paints these red so the blind spot can never be invisible again.
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

    // The #90 blind spot: market-hours warmers that are stale RIGHT NOW during RTH. These break
    // live data and are the highest-priority signal — escalate them above generic staleness.
    const rthStale = snapshot.jobs.filter((j) => j.market_hours_stale);

    // SELF-HEAL (opt-in): when CRON_WATCHDOG_SELF_HEAL=1, auto re-warm stale crons that are SAFE
    // + IDEMPOTENT (only those in the cron-dispatch table). We target the in-RTH market-hours
    // stale jobs — those are the ones breaking live data — and never one-shot/destructive jobs.
    const selfHealEnabled = process.env.CRON_WATCHDOG_SELF_HEAL?.trim() === "1";
    const healTargets = rthStale.filter((j) => isDispatchableCron(j.key));
    const healed: Array<{ key: string; ok: boolean; status: number; detail?: string }> = [];
    if (selfHealEnabled && healTargets.length > 0) {
      for (const job of healTargets) {
        const res = await dispatchCronWarm(job.key);
        healed.push({
          key: job.key,
          ok: res.ok,
          status: res.status,
          detail: res.error ?? res.detail,
        });
        console[res.ok ? "warn" : "error"](
          `[cron/cron-staleness-watchdog] self-heal ${res.ok ? "re-warmed" : "FAILED"} stale cron '${job.key}' (status ${res.status})${
            res.error || res.detail ? ` — ${res.error ?? res.detail}` : ""
          }`
        );
      }
    } else if (rthStale.length > 0 && !selfHealEnabled) {
      // Self-heal could have helped but is disarmed — make that visible to operators.
      console.warn(
        `[cron/cron-staleness-watchdog] ${rthStale.length} market-hours cron(s) STALE during RTH; ` +
          `self-heal is OFF (set CRON_WATCHDOG_SELF_HEAL=1 to auto re-warm): ` +
          rthStale.map((j) => j.key).join(", ")
      );
    }

    let alertDelivered = true;
    if (problems.length > 0) {
      // Lead with the RTH-stale block (the live-data emergency), then the rest.
      const sections: string[] = [];
      if (rthStale.length > 0) {
        sections.push(
          `🔴 **MARKET-HOURS CRON STALE (RTH)** — live data is breaking:\n` +
            rthStale
              .map((j) => `• **${j.name}** (\`${j.key}\`) — ${j.status_label}`)
              .join("\n")
        );
        if (selfHealEnabled && healed.length > 0) {
          sections.push(
            `Self-heal: ` +
              healed
                .map((h) => `\`${h.key}\` ${h.ok ? "re-warmed ✅" : `failed ❌ (${h.detail ?? h.status})`}`)
                .join(" · ")
          );
        }
      }
      const otherProblems = problems.filter((j) => !j.market_hours_stale);
      if (otherProblems.length > 0) {
        sections.push(
          otherProblems
            .map((j) => `• **${j.name}** (\`${j.key}\`) — ${j.status}: ${j.status_label}`)
            .join("\n")
        );
      }

      const title =
        rthStale.length > 0
          ? `🔴 Cron health: ${rthStale.length} market-hours job(s) STALE during RTH`
          : `⚠️ Cron health: ${problems.length} job(s) need attention`;

      alertDelivered = await notifyOpsDiscord({
        title,
        body: sections.join("\n\n"),
        severity: "critical",
      }).catch(() => false);

      // If the alert went nowhere (no webhook configured / delivery failed), DON'T fail silently —
      // this is exactly how #90 stayed invisible. Log loud; it also surfaces in the result below.
      if (!alertDelivered) {
        console.error(
          `[cron/cron-staleness-watchdog] ALERT NOT DELIVERED for ${problems.length} stale/failed cron(s) ` +
            `(${problems.map((j) => j.key).join(", ")}) — Discord webhook unset or unreachable. ` +
            `Set DISCORD_OPS_WEBHOOK_URL.`
        );
      }
    }

    const result = {
      ok: true,
      checked: snapshot.jobs.length,
      problems: problems.length,
      problem_keys: problems.map((j) => j.key),
      rth_stale: rthStale.length,
      rth_stale_keys: rthStale.map((j) => j.key),
      alert_delivered: problems.length > 0 ? alertDelivered : null,
      self_heal_enabled: selfHealEnabled,
      self_healed: healed,
    };
    await logCronRun("cron-staleness-watchdog", started, result);
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/cron-staleness-watchdog]", error);
    await logCronRun("cron-staleness-watchdog", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Watchdog failed" }, { status: 500 });
  }
}
