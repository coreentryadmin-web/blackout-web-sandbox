import "server-only";
import { dbConfigured, dbQuery } from "@/lib/db";
import {
  buildProviderHealthIssues,
  type ProviderTelemetryRollup,
} from "@/lib/provider-health-issues";

export {
  PROVIDER_HEALTH_CATEGORY,
  buildProviderHealthIssues,
  DEFAULT_PROVIDER_HEALTH_THRESHOLDS,
} from "@/lib/provider-health-issues";
export type { ProviderTelemetryRollup, ProviderHealthThresholds } from "@/lib/provider-health-issues";

export async function fetchProviderTelemetryRollups(
  windowMinutes = 10
): Promise<ProviderTelemetryRollup[]> {
  if (!dbConfigured()) return [];
  const mins = Math.min(Math.max(1, Math.round(windowMinutes)), 60);
  try {
    const { rows } = await dbQuery<{
      provider: string;
      calls: string;
      failures: string;
      rate_limits: string;
      top_endpoints: string[] | null;
    }>(
      `WITH recent AS (
         SELECT provider, endpoint, ok, rate_limited
         FROM api_telemetry_events
         WHERE at > NOW() - ($1 || ' minutes')::interval
       ),
       agg AS (
         SELECT
           provider,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE ok = false AND rate_limited = false)::int AS failures,
           COUNT(*) FILTER (WHERE rate_limited = true)::int AS rate_limits
         FROM recent
         GROUP BY provider
       ),
       tops AS (
         SELECT provider, array_agg(endpoint ORDER BY n DESC) AS top_endpoints
         FROM (
           SELECT provider, endpoint, COUNT(*)::int AS n
           FROM recent
           WHERE ok = false AND rate_limited = false
           GROUP BY provider, endpoint
         ) x
         GROUP BY provider
       )
       SELECT
         a.provider,
         a.calls::text,
         a.failures::text,
         a.rate_limits::text,
         COALESCE(t.top_endpoints[1:3], ARRAY[]::text[]) AS top_endpoints
       FROM agg a
       LEFT JOIN tops t ON t.provider = a.provider
       WHERE a.failures > 0 OR a.rate_limits > 0
       ORDER BY a.failures DESC, a.calls DESC`,
      [String(mins)]
    );

    return rows.map((r) => ({
      provider: r.provider,
      calls: Number(r.calls),
      failures: Number(r.failures),
      rate_limits: Number(r.rate_limits),
      top_endpoints: r.top_endpoints ?? [],
    }));
  } catch (err) {
    console.warn("[provider-health-reconcile] telemetry query failed:", err);
    return [];
  }
}

export async function runProviderHealthReconcile(windowMinutes = 10): Promise<{
  rollups: ProviderTelemetryRollup[];
  issues: ReturnType<typeof buildProviderHealthIssues>;
}> {
  const rollups = await fetchProviderTelemetryRollups(windowMinutes);
  const issues = buildProviderHealthIssues(rollups);
  return { rollups, issues };
}
