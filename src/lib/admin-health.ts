import { buildSpxAdminIssues } from "@/lib/admin-spx-issues";
import { getProviderHealthSummary } from "@/lib/api-telemetry";
import { buildMarketHealthSnapshot } from "@/lib/market-health";
import { getAdminRouteErrors } from "@/lib/admin-route-errors";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { getIndexStoreStatus } from "@/lib/ws/polygon-socket";
import { getUwSocketHealth } from "@/lib/ws/uw-socket";
import { uwRateLimiterStats } from "@/lib/providers/uw-rate-limiter";
import { polygonRateLimiterStats } from "@/lib/providers/polygon-rate-limiter";

export type AdminHealthPayload = {
  generated_at: string;
  health_ok: boolean;
  counts: {
    critical: number;
    warning: number;
    info: number;
    api_errors: number;
  };
  issues: Awaited<ReturnType<typeof buildSpxAdminIssues>>["issues"];
  provider_health: ReturnType<typeof getProviderHealthSummary>;
  websockets: {
    polygon_indices: ReturnType<typeof getIndexStoreStatus>;
    unusual_whales: ReturnType<typeof getUwSocketHealth>;
  };
  // Cluster rate-limiter posture — `degraded:true` means the Redis ceiling is down AND we are
  // multi-replica, so each limiter is on the per-replica DEGRADED_LOCAL_RPS budget (gap #1). If
  // REPLICA_COUNT is unset/stale in that state the cluster can still overshoot the upstream ceiling.
  rate_limiters: {
    uw: ReturnType<typeof uwRateLimiterStats>;
    polygon: ReturnType<typeof polygonRateLimiterStats>;
  };
  route_errors: ReturnType<typeof getAdminRouteErrors>;
  market_health_ok: boolean;
};

export async function buildAdminHealthSnapshot(): Promise<AdminHealthPayload> {
  const [{ merged }, marketHealth] = await Promise.all([
    loadMergedSpxDesk(),
    buildMarketHealthSnapshot(),
  ]);

  const issuesPayload = await buildSpxAdminIssues({
    desk: merged,
    play: null,
    marketOpen: merged.market_open === true,
  });

  return {
    generated_at: new Date().toISOString(),
    health_ok: issuesPayload.health_ok && marketHealth.ok,
    counts: {
      critical: issuesPayload.counts.critical,
      warning: issuesPayload.counts.warning,
      info: issuesPayload.counts.info,
      api_errors: issuesPayload.api_errors.length,
    },
    issues: issuesPayload.issues,
    provider_health: getProviderHealthSummary(),
    websockets: {
      polygon_indices: getIndexStoreStatus(),
      unusual_whales: getUwSocketHealth(),
    },
    rate_limiters: {
      uw: uwRateLimiterStats(),
      polygon: polygonRateLimiterStats(),
    },
    route_errors: getAdminRouteErrors(),
    market_health_ok: marketHealth.ok,
  };
}
