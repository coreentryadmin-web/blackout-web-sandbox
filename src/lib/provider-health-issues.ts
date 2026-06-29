import type { SpxAdminIssue } from "@/lib/admin-spx-issues";

export const PROVIDER_HEALTH_CATEGORY = "provider-health";

export type ProviderTelemetryRollup = {
  provider: string;
  calls: number;
  failures: number;
  rate_limits: number;
  top_endpoints: string[];
};

export type ProviderHealthThresholds = {
  failWarn: number;
  failCrit: number;
  minCallsForRate: number;
  rateWarnPct: number;
  rateLimitWarn: number;
};

export const DEFAULT_PROVIDER_HEALTH_THRESHOLDS: ProviderHealthThresholds = {
  failWarn: 5,
  failCrit: 15,
  minCallsForRate: 10,
  rateWarnPct: 0.2,
  rateLimitWarn: 3,
};

/** Pure mapper — exported for tests. */
export function buildProviderHealthIssues(
  rollups: ProviderTelemetryRollup[],
  thresholds: ProviderHealthThresholds = DEFAULT_PROVIDER_HEALTH_THRESHOLDS
): SpxAdminIssue[] {
  const issues: SpxAdminIssue[] = [];

  for (const row of rollups) {
    const failRate = row.calls > 0 ? row.failures / row.calls : 0;
    const endpoints = row.top_endpoints.slice(0, 3).join(", ") || "n/a";
    const baseDetail = `${row.failures} fail / ${row.calls} call(s) in window · top: ${endpoints}`;

    if (row.failures >= thresholds.failCrit) {
      issues.push({
        id: `${PROVIDER_HEALTH_CATEGORY}:${row.provider}:failures`,
        severity: "critical",
        category: PROVIDER_HEALTH_CATEGORY,
        title: `${row.provider} upstream failures`,
        detail: baseDetail,
      });
    } else if (
      row.failures >= thresholds.failWarn ||
      (row.calls >= thresholds.minCallsForRate && failRate >= thresholds.rateWarnPct)
    ) {
      issues.push({
        id: `${PROVIDER_HEALTH_CATEGORY}:${row.provider}:failures`,
        severity: "warning",
        category: PROVIDER_HEALTH_CATEGORY,
        title: `${row.provider} upstream errors elevated`,
        detail: `${baseDetail} · fail rate ${(failRate * 100).toFixed(1)}%`,
      });
    }

    if (row.rate_limits >= thresholds.rateLimitWarn) {
      issues.push({
        id: `${PROVIDER_HEALTH_CATEGORY}:${row.provider}:rate-limit`,
        severity: "warning",
        category: PROVIDER_HEALTH_CATEGORY,
        title: `${row.provider} rate limits`,
        detail: `${row.rate_limits} rate-limited call(s) in the last hour`,
      });
    }
  }

  return issues;
}
