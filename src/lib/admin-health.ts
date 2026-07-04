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
import { buildOpsConfigStatus, type OpsConfigStatus } from "@/lib/ops-config-status";
import { getDatabasePoolStats } from "@/lib/db";

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
  /**
   * This replica's Postgres pool stats (`total`/`idle`/`waiting`). `waiting` > 0 means queries are
   * queued for a connection slot — a leading indicator of PG_POOL_MAX x REPLICA_COUNT approaching
   * PgBouncer's backend budget (docs/PGBOUNCER-SETUP.md), the exact pattern behind the 2026-07-03
   * "Query read timeout" investigation. Folded into `issues`/counts below so it's visible without a
   * direct Postgres connection (unavailable from this sandbox — see CLAUDE.md).
   */
  db_pool: Awaited<ReturnType<typeof getDatabasePoolStats>>;
  market_health_ok: boolean;
  // True when the cluster-wide UW Redis ceiling is down AND we are multi-replica (uw.degraded). In
  // that state each limiter is on the per-replica budget and the cluster can overshoot the upstream
  // UW cap if REPLICA_COUNT is stale — so it is folded into health_ok and the critical-issues path
  // below (audit #8/#78), not just buried in the rate_limiters JSON.
  redis_degraded: boolean;
  /** Premium launch gate — derived from LAUNCHED_TOOLS on this replica. */
  launch_status: LaunchStatusSnapshot;
  /** Env guardrails (no secret values) — audit R-2/R-6/R-18. */
  ops_config: OpsConfigStatus;
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
  const dbPoolStats = await getDatabasePoolStats();
  // Waiting queries queued for a pool slot are a leading indicator of connection-pool
  // exhaustion (PG_POOL_MAX x REPLICA_COUNT approaching PgBouncer's backend budget) — the exact
  // signal missing from the 2026-07-03 "Query read timeout" investigation, which had no way to
  // see this without a direct Postgres connection. Only escalate to CRITICAL (and gate
  // health_ok) when waiting queries have caught up to the pool's full size — genuine saturation,
  // not a single query momentarily queued behind a burst.
  const dbPoolWaiting = dbPoolStats?.configured ? dbPoolStats.waiting : 0;
  const dbPoolSaturated = dbPoolWaiting > 0 && dbPoolStats != null && dbPoolWaiting >= dbPoolStats.total;
  // Redis-degraded = UW Redis ceiling down AND multi-replica (uwStats.degraded already encodes both;
  // a single replica on local pacing is NOT degraded). buildSpxAdminIssues lives outside this cluster
  // and does not yet know about the limiter, so we surface the signal HERE: synthesize a critical
  // issue, bump the critical count, and fold it into health_ok so the admin console flags it (#8/#78).
  const redisDegraded = uwStats.degraded === true;
  const syntheticIssues = [
    ...(redisDegraded
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
        ]
      : []),
    ...(dbPoolWaiting > 0
      ? [
          {
            id: "db_pool:waiting",
            severity: (dbPoolSaturated ? "critical" : "warning") as "critical" | "warning",
            category: "database",
            title: dbPoolSaturated
              ? "Postgres pool saturated — queries queued for every connection slot"
              : "Postgres pool contention — queries queued for a connection",
            detail:
              `${dbPoolWaiting} quer${dbPoolWaiting === 1 ? "y" : "ies"} on this replica waiting for a ` +
              `pool slot (total=${dbPoolStats?.total ?? 0}, idle=${dbPoolStats?.idle ?? 0}). Leading ` +
              `indicator of PG_POOL_MAX x REPLICA_COUNT approaching PgBouncer's backend budget — see ` +
              `docs/PGBOUNCER-SETUP.md.`,
          },
        ]
      : []),
  ];
  const issues = [...syntheticIssues, ...issuesPayload.issues];

  return {
    generated_at: new Date().toISOString(),
    health_ok: issuesPayload.health_ok && marketHealth.ok && !redisDegraded && !dbPoolSaturated,
    counts: {
      critical:
        issuesPayload.counts.critical +
        (redisDegraded ? 1 : 0) +
        (dbPoolSaturated ? 1 : 0),
      warning: issuesPayload.counts.warning + (dbPoolWaiting > 0 && !dbPoolSaturated ? 1 : 0),
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
    db_pool: dbPoolStats,
    market_health_ok: marketHealth.ok,
    redis_degraded: redisDegraded,
    launch_status: getLaunchStatusSnapshot(),
    ops_config: buildOpsConfigStatus(),
  };
}
