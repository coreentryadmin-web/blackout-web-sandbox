// BLACKOUT Intelligence Engine — Phase 4 self-improvement discovery.
// The engine inspects the platform's OWN telemetry every day and turns what it
// finds into recommendations: slowest endpoints, highest-failure providers,
// rate-limit pressure, the most expensive call patterns, unhandled application
// errors, and stalled/failed background jobs. Every discovery is a
// numbers-cited observation persisted into the knowledge store — the platform
// learns about itself the same way it learns about markets. Sources are
// tables/engines this app ALREADY has (api_telemetry_events, error_events,
// and the admin cron-health engine's schedule-aware staleness logic) — no new
// external access; see docs/bie/FULL-SYSTEM-AWARENESS.md for what's covered
// here vs what still needs infrastructure-level access (Railway logs/metrics,
// Redis internals) this codebase does not have today.

import { dbConfigured, dbQuery } from "@/lib/db";
import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { countRecentErrorEvents } from "@/lib/error-sink";
import { todayEt } from "@/lib/nighthawk/session";
import { storeKnowledge } from "./knowledge";

export type DiscoveryRow = {
  provider: string;
  endpoint: string;
  calls: number;
  fail_pct: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  total_time_s: number;
  rate_limited: number;
};

export type ErrorGroup = { source: string; scope: string | null; count: number };

/** The only fields formatDiscovery reads from admin-cron-health's CronJobHealth —
 *  narrowed on purpose so this module (and its tests) don't depend on that
 *  engine's full shape, just the schedule-aware status it computes. */
export type DiscoveryCronJob = {
  key: string;
  status: "healthy" | "warning" | "stale" | "failed" | "unknown";
  status_label: string;
  market_hours_stale: boolean;
  last_message: string | null;
};

/** Pure formatting + recommendation rules over the aggregates. */
export function formatDiscovery(
  date: string,
  rows: DiscoveryRow[],
  errors: { total: number; groups: ErrorGroup[] } = { total: 0, groups: [] },
  cronJobs: DiscoveryCronJob[] = []
): string {
  const findings: string[] = [];
  const sections: string[] = [`BIE platform discovery — ${date} (last 24h)`];

  if (rows.length === 0) {
    sections.push(``, `API telemetry: none recorded in the last 24h.`);
  } else {
    const byTime = [...rows].sort((a, b) => b.total_time_s - a.total_time_s).slice(0, 8);
    for (const r of rows) {
      if (r.calls >= 50 && r.fail_pct >= 10)
        findings.push(
          `${r.provider} ${r.endpoint}: ${r.fail_pct}% failures over ${r.calls} calls — investigate before it becomes an incident.`
        );
      if (r.calls >= 50 && r.p95_latency_ms >= 5000)
        findings.push(
          `${r.provider} ${r.endpoint}: p95 ${r.p95_latency_ms}ms over ${r.calls} calls — slow tail; candidate for caching or a tighter deadline.`
        );
      if (r.rate_limited >= 10)
        findings.push(
          `${r.provider} ${r.endpoint}: rate-limited ${r.rate_limited}× in 24h — budget pressure; consider wider caching or lower cadence.`
        );
    }
    sections.push(
      ``,
      `Most expensive API call patterns (by total time spent):`,
      ...byTime.map(
        (r) =>
          `- ${r.provider} ${r.endpoint}: ${r.calls} calls, avg ${r.avg_latency_ms}ms, p95 ${r.p95_latency_ms}ms, ${r.total_time_s}s total${r.fail_pct > 0 ? `, ${r.fail_pct}% fail` : ""}`
      )
    );
  }

  // Application errors (error_events — unhandled exceptions, request errors).
  if (errors.total > 0) {
    sections.push(
      ``,
      `Application errors (last 24h): ${errors.total} total.`,
      ...errors.groups
        .slice(0, 6)
        .map((g) => `- ${g.source}${g.scope ? `/${g.scope}` : ""}: ${g.count}×`)
    );
    if (errors.total >= 25) findings.push(`Application errors: ${errors.total} in 24h — elevated; review error_events.`);
    const worst = errors.groups[0];
    if (worst && worst.count >= 10)
      findings.push(
        `${worst.source}${worst.scope ? `/${worst.scope}` : ""} is the top error source (${worst.count}× in 24h) — likely a single recurring bug, not noise.`
      );
  } else {
    sections.push(``, `Application errors (last 24h): none recorded.`);
  }

  // Cron/worker health — reuses the SAME schedule-aware engine the admin cron
  // dashboard uses (src/lib/admin-cron-health.ts): market_hours_only jobs get
  // a weekend/off-hours multiplier on their staleness threshold, so a
  // 0DTE-only warmer being quiet at midnight is correctly "healthy", not a
  // false "stale" finding every single night.
  const failed = cronJobs.filter((c) => c.status === "failed");
  const stale = cronJobs.filter((c) => c.status === "stale");
  if (cronJobs.length > 0) {
    sections.push(
      ``,
      `Cron/worker health: ${cronJobs.length} jobs tracked, ${failed.length} failing, ${stale.length} stale (schedule-aware — market-hours-only jobs are not flagged for being quiet off-hours).`
    );
    for (const c of failed) findings.push(`Cron job "${c.key}" is FAILING: ${c.last_message ?? "no message"}.`);
    for (const c of stale)
      findings.push(
        `Cron job "${c.key}" is stale: ${c.status_label}${c.market_hours_stale ? " — LIVE-DATA WARMER SILENT DURING MARKET HOURS, high priority" : ""}.`
      );
  }

  sections.push(
    ``,
    findings.length
      ? `Findings:\n${findings.map((f) => `- ${f}`).join("\n")}`
      : `Findings: none crossing thresholds (≥10% API failures, p95 ≥5s, 10+ rate limits, 25+ app errors, or any failed/stalled cron on ≥50-call or tracked patterns).`
  );
  return sections.join("\n");
}

/** Aggregate yesterday's API telemetry + application errors + cron health, persist the discovery report. */
export async function runBieDiscovery(): Promise<{ patterns: number; text: string } | null> {
  if (!dbConfigured()) return null;
  try {
    const [apiRes, errors, cronHealth] = await Promise.all([
      dbQuery<Record<string, unknown>>(
        `SELECT provider, endpoint,
                COUNT(*)::int AS calls,
                ROUND(100.0 * COUNT(*) FILTER (WHERE NOT ok) / COUNT(*), 1)::float AS fail_pct,
                ROUND(AVG(latency_ms))::int AS avg_latency_ms,
                (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95_latency_ms,
                ROUND(SUM(latency_ms) / 1000.0, 1)::float AS total_time_s,
                COUNT(*) FILTER (WHERE rate_limited)::int AS rate_limited
         FROM api_telemetry_events
         WHERE at >= NOW() - INTERVAL '24 hours'
         GROUP BY provider, endpoint
         HAVING COUNT(*) >= 10
         ORDER BY SUM(latency_ms) DESC
         LIMIT 40`
      ),
      countRecentErrorEvents(24 * 60).catch(() => ({ total: 0, groups: [] })),
      buildCronHealthSnapshot()
        .then((s) => s.jobs)
        .catch(() => []),
    ]);
    const rows: DiscoveryRow[] = (apiRes.rows ?? []).map((r) => ({
      provider: String(r.provider),
      endpoint: String(r.endpoint),
      calls: Number(r.calls) || 0,
      fail_pct: Number(r.fail_pct) || 0,
      avg_latency_ms: Number(r.avg_latency_ms) || 0,
      p95_latency_ms: Number(r.p95_latency_ms) || 0,
      total_time_s: Number(r.total_time_s) || 0,
      rate_limited: Number(r.rate_limited) || 0,
    }));
    const date = todayEt();
    const text = formatDiscovery(date, rows, errors, cronHealth);
    await storeKnowledge("self_eval", `bie:discovery:${date}`, text).catch(() => 0);
    return { patterns: rows.length, text };
  } catch {
    return null;
  }
}
