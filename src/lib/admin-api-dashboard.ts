import {
  API_PROVIDER_CATALOG,
  type ApiProviderCatalogEntry,
  type CatalogEndpoint,
} from "@/lib/api-provider-catalog";
import {
  getApiTelemetrySnapshot,
  getCallsByProvider1m,
  recordApiCall,
  type ApiEndpointStats,
  type ApiProviderId,
} from "@/lib/api-telemetry";
import {
  buildRateQuotaHeadroom,
  deriveClusterCallsByProvider1m,
  type RateQuotaHeadroom,
} from "@/lib/api-rate-quotas";
import { trackedFetch } from "@/lib/api-tracked-fetch";
import { buildEndpointRegistry, type EndpointRegistryPayload } from "@/lib/admin-endpoint-registry";
import { pingDatabase, dbConfigured } from "@/lib/db";
import { engineConfigured, fetchEngine } from "@/lib/engine";
import {
  polygonConfigured,
  uwConfigured,
} from "@/lib/providers/config";
import { webSearchConfigured } from "@/lib/providers/web-search";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { getIndexStoreStatus } from "@/lib/ws/polygon-socket";
import { getUwSocketHealth } from "@/lib/ws/uw-socket";
import { getDatabasePoolStats } from "@/lib/db";
import { getPlayEngineHealth } from "@/lib/play-engine-health";
import { flushTelemetryToRedis, readCrossInstanceTelemetry } from "@/lib/api-telemetry-redis";

export type EndpointDashboardRow = CatalogEndpoint & {
  telemetry: ApiEndpointStats | null;
  status: "ok" | "error" | "idle" | "unconfigured";
};

export type ProviderDashboardRow = Omit<ApiProviderCatalogEntry, "endpoints"> & {
  configured: boolean;
  probe: {
    ok: boolean | null;
    latency_ms: number | null;
    error: string | null;
    at: string | null;
  };
  telemetry: {
    calls: number;
    errors: number;
    error_rate: number;
  };
  endpoints: EndpointDashboardRow[];
};

export type ApiDashboardPayload = {
  generated_at: string;
  summary: {
    providers_total: number;
    providers_configured: number;
    providers_healthy: number;
    calls_window: number;
    errors_window: number;
    error_rate: number;
    window_label: string;
  };
  providers: ProviderDashboardRow[];
  recent_errors: ReturnType<typeof getApiTelemetrySnapshot>["recent_errors"];
  recent_events: ReturnType<typeof getApiTelemetrySnapshot>["recent_events"];
  active_retries: ReturnType<typeof getApiTelemetrySnapshot>["active_retries"];
  registry: EndpointRegistryPayload;
  websockets: {
    polygon_indices: ReturnType<typeof getIndexStoreStatus>;
    unusual_whales: ReturnType<typeof getUwSocketHealth>;
  };
  ops: {
    db_pool: Awaited<ReturnType<typeof getDatabasePoolStats>>;
    play_engine: Awaited<ReturnType<typeof getPlayEngineHealth>>;
    rate_headroom: RateQuotaHeadroom[];
  };
  /**
   * Cluster-wide telemetry aggregated across all live replicas via Redis.
   * null when REDIS_URL is unset or Redis is unavailable — in that case the
   * dashboard is replica-local exactly as before (local-only fallback unchanged).
   */
  cluster: {
    instances_reporting: number;
    rate_limits: Partial<Record<ApiProviderId, number>>;
    by_provider: Partial<Record<ApiProviderId, { cross_calls_5m: number; cross_errors_5m: number }>>;
  } | null;
};

function normalizeEndpointKey(endpoint: string): string {
  return endpoint.replace(/\{[^}]+\}/g, "{*}").replace(/\/\d+/g, "/{*}");
}

function matchTelemetry(
  catalogEp: CatalogEndpoint,
  provider: ApiProviderId,
  stats: ApiEndpointStats[]
): ApiEndpointStats | null {
  const normCatalog = normalizeEndpointKey(catalogEp.endpoint);
  let best: ApiEndpointStats | null = null;

  for (const s of stats) {
    const normStat = normalizeEndpointKey(s.endpoint);
    const exact = s.endpoint === catalogEp.endpoint && s.method === catalogEp.method;
    const fuzzy =
      normStat === normCatalog ||
      normStat.startsWith(normCatalog.replace("{*}", "")) ||
      normCatalog.includes(normStat.replace("{*}", ""));

    if (exact || fuzzy) {
      if (!best || (s.last_at && (!best.last_at || s.last_at > best.last_at))) {
        best = s;
      }
    }
  }

  if (best) return best;

  const prefix = catalogEp.endpoint.split("{")[0];
  return (
    stats.find(
      (s) =>
        s.method === catalogEp.method &&
        (s.endpoint === catalogEp.endpoint || s.endpoint.startsWith(prefix))
    ) ?? null
  );
}

function endpointStatus(
  configured: boolean,
  telemetry: ApiEndpointStats | null
): EndpointDashboardRow["status"] {
  if (!configured) return "unconfigured";
  if (!telemetry?.last_at) return "idle";
  return telemetry.last_ok ? "ok" : "error";
}

async function probePolygon(): Promise<{ ok: boolean; latency_ms: number; error: string | null }> {
  if (!polygonConfigured()) return { ok: false, latency_ms: 0, error: "Not configured" };
  const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
  const KEY = process.env.POLYGON_API_KEY ?? "";
  const qs = new URLSearchParams({ apiKey: KEY });
  const start = Date.now();
  try {
    const res = await trackedFetch(
      "polygon",
      "/v1/marketstatus/now",
      `${BASE}/v1/marketstatus/now?${qs}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    return {
      ok: res.ok,
      latency_ms: Date.now() - start,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: e instanceof Error ? e.message : "Probe failed",
    };
  }
}

async function probeUnusualWhales(): Promise<{ ok: boolean; latency_ms: number; error: string | null }> {
  if (!uwConfigured()) return { ok: false, latency_ms: 0, error: "Not configured" };
  const BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
  const KEY = process.env.UW_API_KEY ?? "";
  const start = Date.now();
  try {
    const res = await trackedFetch(
      "unusual_whales",
      "/api/market/market-tide",
      `${BASE}/api/market/market-tide`,
      {
        headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
        cache: "no-store",
      }
    );
    return {
      ok: res.ok,
      latency_ms: Date.now() - start,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: e instanceof Error ? e.message : "Probe failed",
    };
  }
}

async function probeEngine(): Promise<{ ok: boolean; latency_ms: number; error: string | null }> {
  if (!engineConfigured()) return { ok: false, latency_ms: 0, error: "Not configured" };
  const start = Date.now();
  try {
    await fetchEngine("/health");
    return { ok: true, latency_ms: Date.now() - start, error: null };
  } catch (e) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: e instanceof Error ? e.message : "Probe failed",
    };
  }
}

async function probePostgres(): Promise<{ ok: boolean; latency_ms: number; error: string | null }> {
  if (!dbConfigured()) return { ok: false, latency_ms: 0, error: "Not configured" };
  const start = Date.now();
  const result = await pingDatabase();
  const latency_ms = Date.now() - start;
  recordApiCall({
    provider: "postgres",
    endpoint: "SELECT 1",
    method: "SQL",
    status: result.ok ? 200 : 500,
    ok: result.ok,
    latency_ms,
    error: result.error ?? null,
  });
  return {
    ok: result.ok,
    latency_ms,
    error: result.error ?? null,
  };
}

function isConfigured(id: ApiProviderId): boolean {
  switch (id) {
    case "polygon":
      return polygonConfigured();
    case "unusual_whales":
      return uwConfigured();
    case "anthropic":
      return anthropicConfigured();
    case "blackout_engine":
      return engineConfigured();
    case "postgres":
      return dbConfigured();
    case "web_search":
      return webSearchConfigured();
    default:
      return false;
  }
}

const PROBE_FNS: Record<
  ApiProviderId,
  () => Promise<{ ok: boolean; latency_ms: number; error: string | null }>
> = {
  polygon: probePolygon,
  unusual_whales: probeUnusualWhales,
  anthropic: async () =>
    anthropicConfigured()
      ? { ok: true, latency_ms: 0, error: null }
      : { ok: false, latency_ms: 0, error: "Not configured" },
  blackout_engine: probeEngine,
  postgres: probePostgres,
  web_search: async () =>
    webSearchConfigured()
      ? { ok: true, latency_ms: 0, error: null }
      : { ok: false, latency_ms: 0, error: "Not configured" },
};

export async function fetchApiDashboard(options?: {
  probe?: boolean;
  windowMs?: number;
}): Promise<ApiDashboardPayload> {
  const windowMs = options?.windowMs ?? 5 * 60_000;
  const telemetry = getApiTelemetrySnapshot(windowMs);

  const probeResults = new Map<
    ApiProviderId,
    { ok: boolean; latency_ms: number; error: string | null; at: string | null }
  >();

  if (options?.probe) {
    await Promise.all(
      (Object.keys(PROBE_FNS) as ApiProviderId[]).map(async (id) => {
        const result = await PROBE_FNS[id]();
        probeResults.set(id, {
          ...result,
          at: new Date().toISOString(),
        });
      })
    );
  }

  // Read the cluster-wide rollup BEFORE building provider rows so the health/summary
  // numbers below can be based on what the whole cluster did, not just this replica.
  // The serving replica is often idle (it only handles admin traffic), so its local
  // telemetry legitimately reads 0 calls while other replicas are doing all the work —
  // basing the headline summary on local-only numbers produced the self-contradicting
  // "calls_window: 0 / providers_healthy: 0/4" right above a cluster block reporting
  // 61 live calls. Flush this replica's own rollup first so it is counted in the read.
  await flushTelemetryToRedis();
  const crossTelemetry = await readCrossInstanceTelemetry();

  const providers: ProviderDashboardRow[] = API_PROVIDER_CATALOG.map((catalog) => {
    const configured = isConfigured(catalog.id);
    const tel = telemetry.by_provider[catalog.id];
    const cross = crossTelemetry?.providers[catalog.id];
    const probe = probeResults.get(catalog.id);
    // Health inference without an explicit probe: local calls first, then the cluster's
    // per-provider 5m rollup — an idle serving replica must not report a provider as
    // unknown/unhealthy when the rest of the cluster is calling it successfully.
    const inferredOk =
      tel && tel.calls > 0
        ? tel.errors === 0
        : cross && cross.calls_5m > 0
          ? cross.errors_5m === 0
          : null;
    const probeFallback = probe ?? {
      ok: options?.probe ? false : inferredOk,
      latency_ms: null as number | null,
      error: options?.probe ? "Probe skipped" : null,
      at: null as string | null,
    };

    const endpointStats = tel?.endpoints ?? [];
    const { endpoints: catalogEndpoints, ...catalogRest } = catalog;

    const endpoints: EndpointDashboardRow[] = catalogEndpoints.map((ep) => {
      const t = matchTelemetry(ep, catalog.id, endpointStats);
      return {
        ...ep,
        telemetry: t,
        status: endpointStatus(configured, t),
      };
    });

    return {
      ...catalogRest,
      endpoints,
      configured,
      probe: {
        ok: probeFallback.ok === null ? null : probeFallback.ok && configured,
        latency_ms: probeFallback.latency_ms,
        error: configured ? probeFallback.error : "Not configured",
        at: probeFallback.at,
      },
      telemetry: {
        calls: tel?.calls ?? 0,
        errors: tel?.errors ?? 0,
        error_rate: tel?.calls ? (tel.errors / tel.calls) * 100 : 0,
      },
    };
  });

  const configuredCount = providers.filter((p) => p.configured).length;
  const healthyCount = providers.filter((p) => p.configured && p.probe.ok === true).length;

  const [dbPool, playEngine] = await Promise.all([
    getDatabasePoolStats(),
    getPlayEngineHealth(),
  ]);

  const cluster: ApiDashboardPayload["cluster"] = crossTelemetry
    ? {
        instances_reporting: crossTelemetry.instances_reporting,
        rate_limits: crossTelemetry.rate_limits,
        by_provider: Object.fromEntries(
          Object.entries(crossTelemetry.providers).map(([provider, stats]) => [
            provider,
            { cross_calls_5m: stats?.calls_5m ?? 0, cross_errors_5m: stats?.errors_5m ?? 0 },
          ])
        ) as NonNullable<ApiDashboardPayload["cluster"]>["by_provider"],
      }
    : null;
  // Feed the headroom panel from the cluster-wide rollup, not this replica's own in-memory
  // counter (see deriveClusterCallsByProvider1m for why a single replica's count is misleading).
  const clusterCallsByProvider1m = deriveClusterCallsByProvider1m(
    crossTelemetry?.providers,
    getCallsByProvider1m()
  );
  const rateHeadroom = buildRateQuotaHeadroom(clusterCallsByProvider1m);

  // Headline totals: prefer the cluster-wide 5m rollup over this replica's local
  // snapshot — but ONLY when the requested window IS 5m (the cluster rollup's fixed
  // window). For a custom window_min the local snapshot is the only source with that
  // window, so it stays authoritative rather than silently mislabeling 5m data.
  const clusterTotals =
    crossTelemetry && windowMs === 5 * 60_000
      ? Object.values(crossTelemetry.providers).reduce(
          (acc, s) => ({
            calls: acc.calls + (s?.calls_5m ?? 0),
            errors: acc.errors + (s?.errors_5m ?? 0),
          }),
          { calls: 0, errors: 0 }
        )
      : null;
  const callsWindow = clusterTotals?.calls ?? telemetry.totals.calls;
  const errorsWindow = clusterTotals?.errors ?? telemetry.totals.errors;

  // The registry carries its own runtime counters (rendered as the "Calls (5m)"
  // stat) — align them with the same cluster rollup so the two summaries the admin
  // sees on one screen can never disagree with each other.
  const registry = buildEndpointRegistry(windowMs);
  if (clusterTotals) {
    registry.summary.runtime_calls_window = clusterTotals.calls;
    registry.summary.runtime_errors_window = clusterTotals.errors;
  }

  return {
    generated_at: new Date().toISOString(),
    summary: {
      providers_total: providers.length,
      providers_configured: configuredCount,
      providers_healthy: healthyCount,
      calls_window: callsWindow,
      errors_window: errorsWindow,
      error_rate: callsWindow ? (errorsWindow / callsWindow) * 100 : 0,
      window_label: `${Math.round(windowMs / 60_000)}m`,
    },
    providers,
    recent_errors: telemetry.recent_errors,
    recent_events: telemetry.recent_events,
    active_retries: telemetry.active_retries,
    registry,
    websockets: {
      polygon_indices: getIndexStoreStatus(),
      unusual_whales: getUwSocketHealth(),
    },
    ops: {
      db_pool: dbPool,
      play_engine: playEngine,
      rate_headroom: rateHeadroom,
    },
    cluster,
  };
}
