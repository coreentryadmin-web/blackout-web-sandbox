// BLACKOUT Intelligence Engine — Phase 4 self-improvement discovery.
// The engine inspects the platform's OWN telemetry every day and turns what it
// finds into recommendations: slowest endpoints, highest-failure providers,
// rate-limit pressure, the most expensive call patterns by total time spent.
// Every discovery is a numbers-cited observation persisted into the knowledge
// store — the platform learns about itself the same way it learns about markets.

import { dbConfigured, dbQuery } from "@/lib/db";
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

/** Pure formatting + recommendation rules over the aggregates. */
export function formatDiscovery(date: string, rows: DiscoveryRow[]): string {
  if (rows.length === 0) {
    return `BIE platform discovery — ${date}\n\nNo API telemetry recorded in the last 24h.`;
  }
  const byTime = [...rows].sort((a, b) => b.total_time_s - a.total_time_s).slice(0, 8);
  const findings: string[] = [];
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
  return [
    `BIE platform discovery — ${date} (last 24h of API telemetry)`,
    ``,
    `Most expensive call patterns (by total time spent):`,
    ...byTime.map(
      (r) =>
        `- ${r.provider} ${r.endpoint}: ${r.calls} calls, avg ${r.avg_latency_ms}ms, p95 ${r.p95_latency_ms}ms, ${r.total_time_s}s total${r.fail_pct > 0 ? `, ${r.fail_pct}% fail` : ""}`
    ),
    ``,
    findings.length
      ? `Findings:\n${findings.map((f) => `- ${f}`).join("\n")}`
      : `Findings: none crossing thresholds (≥10% failures, p95 ≥5s, or 10+ rate limits on ≥50-call patterns).`,
  ].join("\n");
}

/** Aggregate yesterday's API telemetry, persist the discovery report. */
export async function runBieDiscovery(): Promise<{ patterns: number } | null> {
  if (!dbConfigured()) return null;
  try {
    const res = await dbQuery<Record<string, unknown>>(
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
    );
    const rows: DiscoveryRow[] = (res.rows ?? []).map((r) => ({
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
    await storeKnowledge("self_eval", `bie:discovery:${date}`, formatDiscovery(date, rows)).catch(() => 0);
    return { patterns: rows.length };
  } catch {
    return null;
  }
}
