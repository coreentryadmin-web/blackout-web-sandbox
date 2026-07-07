import { after, NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";
import { logCronRun } from "@/lib/cron-run";
import { dispatchCronWarm, isDispatchableCron } from "@/lib/cron-dispatch";
import { countRecentErrorEvents, classifyErrorSpike } from "@/lib/error-sink";

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

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

    // Self-heal MUST NOT block the HTTP response. Each dispatchCronWarm can run a full warmer
    // (grid-warm, heatmap-warm, …) synchronously — several in sequence routinely exceeds
    // Cloudflare's ~100s origin timeout → HTTP 524 on this route and a false P0 in ops-collect.
    // Mirror nighthawk-edition: dispatch in after() so the snapshot returns in seconds.
    const runSelfHeal = async () => {
      for (const job of healTargets) {
        const res = await dispatchCronWarm(job.key);
        console[res.ok ? "warn" : "error"](
          `[cron/cron-staleness-watchdog] self-heal ${res.ok ? "re-warmed" : "FAILED"} stale cron '${job.key}' (status ${res.status})${
            res.error || res.detail ? ` — ${res.error ?? res.detail}` : ""
          }`
        );
      }
    };
    if (selfHealEnabled && healTargets.length > 0) {
      const dispatchHeal = () => {
        void runSelfHeal().catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          console.error(`[cron/cron-staleness-watchdog] background self-heal REJECTED: ${detail}`);
        });
      };
      try {
        after(dispatchHeal);
      } catch {
        dispatchHeal();
      }
    } else if (rthStale.length > 0 && !selfHealEnabled) {
      // Self-heal could have helped but is disarmed — make that visible to operators.
      console.warn(
        `[cron/cron-staleness-watchdog] ${rthStale.length} market-hours cron(s) STALE during RTH; ` +
          `self-heal is OFF (set CRON_WATCHDOG_SELF_HEAL=1 to auto re-warm): ` +
          rthStale.map((j) => j.key).join(", ")
      );
    }

    // Error-rate spike: read the web app's durable error sink (error_events) over a short window.
    // A burst of persisted errors is a prod-health signal the per-cron alerts can't see. Tunable.
    const errWindowMin = envNum("CRON_WATCHDOG_ERROR_WINDOW_MIN", 15);
    const errWarn = envNum("CRON_WATCHDOG_ERROR_WARN", 25);
    const errCrit = envNum("CRON_WATCHDOG_ERROR_CRIT", 75);
    const recentErrors = await countRecentErrorEvents(errWindowMin);
    const errorSpike = classifyErrorSpike(recentErrors.total, errWarn, errCrit);

    let alertDelivered = true;
    if (problems.length > 0 || errorSpike !== "none") {
      // Lead with the RTH-stale block (the live-data emergency), then the rest.
      const sections: string[] = [];
      if (errorSpike !== "none") {
        const top = recentErrors.groups
          .slice(0, 5)
          .map((g) => `• \`${g.source}${g.scope ? `/${g.scope}` : ""}\` ×${g.count}`)
          .join("\n");
        sections.push(
          `${errorSpike === "critical" ? "🔴" : "⚠️"} **ERROR SPIKE** — ${recentErrors.total} error(s) ` +
            `in the last ${errWindowMin}m (warn ${errWarn} / crit ${errCrit}):\n${top}`
        );
      }
      if (rthStale.length > 0) {
        sections.push(
          `🔴 **MARKET-HOURS CRON STALE (RTH)** — live data is breaking:\n` +
            rthStale
              .map((j) => `• **${j.name}** (\`${j.key}\`) — ${j.status_label}`)
              .join("\n")
        );
        if (selfHealEnabled && healTargets.length > 0) {
          sections.push(
            `Self-heal dispatched (background): ${healTargets.map((j) => `\`${j.key}\``).join(" · ")}`
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
          : problems.length > 0
            ? `⚠️ Cron health: ${problems.length} job(s) need attention`
            : `${errorSpike === "critical" ? "🔴" : "⚠️"} Prod error spike: ${recentErrors.total} in ${errWindowMin}m`;

      const severity: "critical" | "warning" =
        rthStale.length > 0 || problems.length > 0 || errorSpike === "critical" ? "critical" : "warning";

      alertDelivered = await notifyOpsDiscord({
        title,
        body: sections.join("\n\n"),
        severity,
      }).catch(() => false);

      // If the alert went nowhere (no webhook configured / delivery failed), DON'T fail silently —
      // this is exactly how #90 stayed invisible. Log loud; it also surfaces in the result below.
      if (!alertDelivered) {
        console.error(
          `[cron/cron-staleness-watchdog] ALERT NOT DELIVERED ` +
            `(${problems.length} stale/failed cron(s); error-spike=${errorSpike}, ${recentErrors.total} in ${errWindowMin}m) ` +
            `— Discord webhook unset or unreachable. Set DISCORD_OPS_WEBHOOK_URL.`
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
      error_window_min: errWindowMin,
      error_count: recentErrors.total,
      error_spike: errorSpike,
      alert_delivered: problems.length > 0 || errorSpike !== "none" ? alertDelivered : null,
      self_heal_enabled: selfHealEnabled,
      self_heal_dispatched: healTargets.map((j) => j.key),
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
