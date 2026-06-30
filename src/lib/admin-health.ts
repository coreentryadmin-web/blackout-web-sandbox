import { buildSpxAdminIssues } from "@/lib/admin-spx-issues";
import { getProviderHealthSummary } from "@/lib/api-telemetry";
import { buildMarketHealthSnapshot } from "@/lib/market-health";
import { getAdminRouteErrors } from "@/lib/admin-route-errors";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { getIndexStoreStatus } from "@/lib/ws/polygon-socket";
import { getUwSocketHealth } from "@/lib/ws/uw-socket";
import { getOptionsSocketStatus } from "@/lib/ws/options-socket";
import { getStocksSocketStatus } from "@/lib/ws/stocks-socket";
import { uwRateLimiterStats } from "@/lib/providers/uw-rate-limiter";
import { polygonRateLimiterStats } from "@/lib/providers/polygon-rate-limiter";
import { getLaunchStatusSnapshot, type LaunchStatusSnapshot } from "@/lib/tool-access";

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
    // Massive options WS (Night's Watch live marks). enabled:true + authenticated shards>0 during RTH
    // confirms OPTIONS_WS_ENABLED + the key are live; enabled-but-no-shards = the "enabled != working"
    // trap (gap #5) where valuation silently falls back to the 60-120s snapshot path.
    options: ReturnType<typeof getOptionsSocketStatus>;
    /** Massive stocks LULD halt feed (second source vs UW trading_halts). */
    stocks_luld: ReturnType<typeof getStocksSocketStatus>;
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
  // True when the cluster-wide UW Redis ceiling is down AND we are multi-replica (uw.degraded). In
  // that state each limiter is on the per-replica budget and the cluster can overshoot the upstream
  // UW cap if REPLICA_COUNT is stale — so it is folded into health_ok and the critical-issues path
  // below (audit #8/#78), not just buried in the rate_limiters JSON.
  redis_degraded: boolean;
  /** Premium launch gate — derived from LAUNCHED_TOOLS on this replica. */
  launch_status: LaunchStatusSnapshot;
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

  const uwStats = uwRateLimiterStats();
  // Redis-degraded = UW Redis ceiling down AND multi-replica (uwStats.degraded already encodes both;
  // a single replica on local pacing is NOT degraded). buildSpxAdminIssues lives outside this cluster
  // and does not yet know about the limiter, so we surface the signal HERE: synthesize a critical
  // issue, bump the critical count, and fold it into health_ok so the admin console flags it (#8/#78).
  const redisDegraded = uwStats.degraded === true;
  const issues = redisDegraded
    ? [
        {
          id: "rate_limit:redis_degraded",
          severity: "critical" as const,
          category: "rate_limit",
          title: "UW rate-limiter degraded — Redis ceiling down",
          detail:
            `Cluster-wide UW Redis ceiling unavailable; each replica is on per-replica pacing ` +
            `${uwStats.degradedLocalRps.toFixed(2)} rps (REPLICA_COUNT=${uwStats.replicaCount}). ` +
            `If REPLICA_COUNT is stale the cluster can overshoot the upstream UW cap.`,
        },
        ...issuesPayload.issues,
      ]
    : issuesPayload.issues;

  return {
    generated_at: new Date().toISOString(),
    health_ok: issuesPayload.health_ok && marketHealth.ok && !redisDegraded,
    counts: {
      critical: issuesPayload.counts.critical + (redisDegraded ? 1 : 0),
      warning: issuesPayload.counts.warning,
      info: issuesPayload.counts.info,
      api_errors: issuesPayload.api_errors.length,
    },
    issues,
    provider_health: getProviderHealthSummary(),
    websockets: {
      polygon_indices: getIndexStoreStatus(),
      unusual_whales: getUwSocketHealth(),
      options: getOptionsSocketStatus(),
      stocks_luld: getStocksSocketStatus(),
    },
    rate_limiters: {
      uw: uwStats,
      polygon: polygonRateLimiterStats(),
    },
    route_errors: getAdminRouteErrors(),
    market_health_ok: marketHealth.ok,
    redis_degraded: redisDegraded,
    launch_status: getLaunchStatusSnapshot(),
  };
}
