import {
  getApiTelemetrySnapshot,
  getProviderHealthSummary,
  type ApiProviderId,
} from "@/lib/api-telemetry";
import { getFlowEventsBridgeStatus } from "@/lib/flow-events";
import { getDatabasePoolStats, pingDatabase, databaseConnectionMode } from "@/lib/db";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { getIndexStoreStatus } from "@/lib/ws/polygon-socket";
import { getUwSocketHealth } from "@/lib/ws/uw-socket";
import { readPolygonClusterHealth } from "@/lib/ws/socket-cluster-health";
import { getRedisPubSubStatus } from "@/lib/redis-pubsub";
import { flushTelemetryToRedis, readCrossInstanceTelemetry } from "@/lib/api-telemetry-redis";
import { getPlayEngineHealth } from "@/lib/play-engine-health";

export async function buildMarketHealthSnapshot() {
  await flushTelemetryToRedis();

  const [db, pool, crossTelemetry, playEngine] = await Promise.all([
    pingDatabase(),
    getDatabasePoolStats(),
    readCrossInstanceTelemetry(),
    getPlayEngineHealth(),
  ]);

  const localTelemetry = getApiTelemetrySnapshot(5 * 60_000);
  const providerHealth = getProviderHealthSummary(5 * 60_000);

  const rateLimits = {
    local: providerHealth.rate_limits,
    cross_instance: crossTelemetry?.rate_limits ?? null,
    instances_reporting: crossTelemetry?.instances_reporting ?? 0,
    alerts: buildRateLimitAlerts(providerHealth, crossTelemetry),
  };

  const polygonWs = getIndexStoreStatus();
  const polygonCluster = await readPolygonClusterHealth(polygonWs.is_leader);
  const uwWs = getUwSocketHealth();
  const flowBridge = getFlowEventsBridgeStatus();

  const ok =
    (polygonConfigured() || uwConfigured()) &&
    (process.env.NODE_ENV !== "production" || db.ok);

  return {
    ok,
    as_of: new Date().toISOString(),
    providers: {
      polygon: polygonConfigured(),
      unusual_whales: uwConfigured(),
    },
    postgres: {
      ok: db.ok,
      required_in_prod: process.env.NODE_ENV === "production",
      mode: db.mode ?? databaseConnectionMode(),
      error: db.error ?? null,
      pool,
    },
    websockets: {
      polygon_indices: {
        ...polygonWs,
        cluster_live: polygonCluster.cluster_live,
        cluster_spx_age_ms: polygonCluster.cluster_spx_age_ms,
      },
      unusual_whales: uwWs,
    },
    flow_events: flowBridge,
    redis: getRedisPubSubStatus(),
    api_telemetry: {
      window_ms: localTelemetry.totals.window_ms,
      totals: localTelemetry.totals,
      by_provider: localTelemetry.by_provider,
      recent_errors: localTelemetry.recent_errors.slice(0, 10),
      active_retries: localTelemetry.active_retries,
      provider_health: providerHealth.by_provider,
      last_calls: providerHealth.last_calls,
    },
    rate_limits: rateLimits,
    play_engine: playEngine,
  };
}

function buildRateLimitAlerts(
  local: ReturnType<typeof getProviderHealthSummary>,
  cross: Awaited<ReturnType<typeof readCrossInstanceTelemetry>> | null
) {
  const alerts: Array<{
    provider: ApiProviderId;
    severity: "warning" | "critical";
    message: string;
    count_5m: number;
  }> = [];

  const providers: ApiProviderId[] = ["polygon", "unusual_whales", "anthropic"];

  for (const provider of providers) {
    const localCount = local.rate_limits[provider] ?? 0;
    const crossCount = cross?.rate_limits?.[provider] ?? 0;
    const count = Math.max(localCount, crossCount);
    if (count >= 5) {
      alerts.push({
        provider,
        severity: "critical",
        message: `${provider} hit ${count} rate limits in the last 5 minutes`,
        count_5m: count,
      });
    } else if (count >= 2) {
      alerts.push({
        provider,
        severity: "warning",
        message: `${provider} hit ${count} rate limits in the last 5 minutes`,
        count_5m: count,
      });
    }
  }

  return alerts;
}
