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
import { listOpenAdminIncidents } from "@/lib/admin-incidents";
import { todayEt } from "@/features/nighthawk/lib/session";
import { detectMissedAlertWindows } from "./missed-alerts";
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

/** The only fields formatDiscovery reads from admin-incidents' AdminIncidentRow —
 *  these are already-CONFIRMED problems, auto-opened by the data-integrity cron's
 *  own cross-tool validation (see data-integrity/route.ts), not something BIE
 *  decides on its own — BIE only surfaces what the validation layer already found. */
export type DiscoveryIncident = {
  id: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  opened_at: string;
};

/** A single independently-decided "this displayed number looks wrong" finding
 *  from the data-correctness cron's layered checks (shadow-recompute/invariant/
 *  sanity/cross-provider/cross-tool/freshness) — see run-correctness.ts. */
export type DataCorrectnessFlag = { layer: string; metric: string; detail: string };

/** The subset of the data-correctness cron's logged payload (cron_job_runs.meta_json)
 *  formatDiscovery needs. Read from the LATEST logged run, never re-computed here —
 *  BIE reports what the validator already decided, it never re-derives correctness
 *  itself (see docs/bie/FULL-SYSTEM-AWARENESS.md's primary-objective charter). */
export type DataCorrectnessSummary = {
  ran_at: string;
  overall_status: string;
  market_open: boolean;
  flags: DataCorrectnessFlag[];
  independently_confirmed: number;
  consistency_only: number;
};

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
  cronJobs: DiscoveryCronJob[] = [],
  incidents: DiscoveryIncident[] = [],
  correctness: DataCorrectnessSummary | null = null
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

  // Missed-alert risk (Stage 2, cron-outage ground truth — see missed-alerts.ts):
  // narrower than the general cron-health block above — only the crons that
  // themselves PRODUCE a member-visible alert (flow-ingest, spx-evaluate,
  // gex-alerts), not cache warmers or validators. "We know we didn't evaluate,"
  // never a claim that a real setup existed and was missed.
  const missedAlerts = detectMissedAlertWindows(cronJobs);
  if (missedAlerts.outage_count > 0) {
    sections.push(
      ``,
      `Missed-alert risk: ${missedAlerts.outage_count} alert-producing cron(s) down during their live window right now.`
    );
    for (const w of missedAlerts.windows)
      findings.push(
        `Missed-alert risk: "${w.job_key}" is down (${w.status_label}) — any real setup during this window was never evaluated.`
      );
  }

  // Open admin incidents — auto-opened by the data-integrity cron's own cross-tool
  // validation (desk vs heatmap vs quote, SPY/SPX tracking, max-pain, GEX freshness).
  // These are already-CONFIRMED problems by the time they reach here, not something
  // BIE is deciding on its own — every open incident is a finding, no threshold.
  if (incidents.length > 0) {
    sections.push(
      ``,
      `Open data-integrity incidents: ${incidents.length}.`,
      ...incidents.slice(0, 8).map((i) => `- [${i.severity}/${i.category}] ${i.title}`)
    );
    for (const i of incidents)
      findings.push(`Open incident [${i.severity}] ${i.title}: ${i.detail} — already confirmed by data-integrity, not a guess.`);
  }

  // Data-correctness scorecard — the layered shadow-recompute/cross-provider sweep
  // (run-correctness.ts) across heat maps, SPX desk, HELIX flows, Night's Watch, Night
  // Hawk, track record. BIE reports what this ALREADY decided; it never re-derives
  // correctness itself. "consistency-only" metrics are an honest coverage gap, not a
  // false green — surfaced as a finding only when the run had ZERO independent
  // confirmation during market hours (the oracle answered for nothing that run).
  if (correctness) {
    sections.push(
      ``,
      `Data-correctness scorecard (${correctness.ran_at}): ${correctness.overall_status}, ` +
        `${correctness.flags.length} flag(s), ${correctness.independently_confirmed} independently confirmed, ` +
        `${correctness.consistency_only} consistency-only.`
    );
    for (const f of correctness.flags.slice(0, 8))
      findings.push(`Data-correctness FLAG [${f.layer}/${f.metric}]: ${f.detail} — a displayed number is probably wrong.`);
    if (
      correctness.market_open &&
      correctness.flags.length === 0 &&
      correctness.consistency_only > 0 &&
      correctness.independently_confirmed === 0
    )
      findings.push(
        `Data-correctness: 0 independently-confirmed metrics this run during market hours — coverage gap, not a guarantee the numbers are right.`
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

/** Open admin incidents, narrowed to what formatDiscovery/the admin UI need.
 *  Exported so /api/admin/bie-report can expose these as structured JSON
 *  (for clickable ack/resolve UI) without a second, duplicate query. */
export async function fetchDiscoveryIncidents(): Promise<DiscoveryIncident[]> {
  const rows = await listOpenAdminIncidents(10).catch(() => []);
  return rows.map((i) => ({
    id: i.id,
    severity: i.severity,
    category: i.category,
    title: i.title,
    detail: i.detail,
    opened_at: i.opened_at,
  }));
}

/** Latest logged data-correctness run, parsed. READS the already-decided result —
 *  never re-runs the sweep (BIE reports validated findings, it doesn't validate).
 *  Exported for the same reason as fetchDiscoveryIncidents above. */
export async function fetchDataCorrectnessSummary(): Promise<DataCorrectnessSummary | null> {
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT started_at, meta_json FROM cron_job_runs
     WHERE job_key = 'data-correctness' AND status <> 'skipped'
     ORDER BY started_at DESC LIMIT 1`
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const row = res.rows?.[0];
  if (!row) return null;
  const meta = (row.meta_json ?? {}) as Record<string, unknown>;
  const totals = (meta.totals ?? {}) as Record<string, unknown>;
  return {
    ran_at: String(row.started_at),
    overall_status: String(meta.overall_status ?? "unknown"),
    market_open: Boolean(meta.market_open),
    flags: Array.isArray(meta.flags) ? (meta.flags as DataCorrectnessFlag[]) : [],
    independently_confirmed: Number(totals.independentlyConfirmed) || 0,
    consistency_only: Number(totals.consistencyOnly) || 0,
  };
}

/** Aggregate yesterday's API telemetry + application errors + cron health, persist the discovery report. */
export async function runBieDiscovery(): Promise<{ patterns: number; text: string } | null> {
  if (!dbConfigured()) return null;
  try {
    const [apiRes, errors, cronHealth, incidents, correctness] = await Promise.all([
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
      fetchDiscoveryIncidents(),
      fetchDataCorrectnessSummary(),
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
    const text = formatDiscovery(date, rows, errors, cronHealth, incidents, correctness);
    await storeKnowledge("self_eval", `bie:discovery:${date}`, text).catch(() => 0);
    return { patterns: rows.length, text };
  } catch {
    return null;
  }
}
