import {
  API_PROVIDER_CATALOG,
  type ApiProviderCatalogEntry,
  type CatalogEndpoint,
} from "@/lib/api-provider-catalog";
import {
  getApiTelemetrySnapshot,
  recordApiCall,
  type ApiEndpointStats,
  type ApiProviderId,
} from "@/lib/api-telemetry";
import { pingDatabase, dbConfigured } from "@/lib/db";
import { engineConfigured, fetchEngine } from "@/lib/engine";
import {
  polygonConfigured,
  uwConfigured,
  finnhubConfigured,
} from "@/lib/providers/config";
import { anthropicConfigured } from "@/lib/providers/anthropic";
import { trackedFetch } from "@/lib/api-tracked-fetch";

export type EndpointDashboardRow = CatalogEndpoint & {
  telemetry: ApiEndpointStats | null;
  status: "ok" | "error" | "idle" | "unconfigured";
};

export type ProviderDashboardRow = Omit<ApiProviderCatalogEntry, "endpoints"> & {
  configured: boolean;
  probe: {
    ok: boolean;
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

async function probeFinnhub(): Promise<{ ok: boolean; latency_ms: number; error: string | null }> {
  if (!finnhubConfigured()) return { ok: false, latency_ms: 0, error: "Not configured" };
  const key = process.env.FINNHUB_API_KEY?.trim() ?? "";
  const from = new Date().toISOString().slice(0, 10);
  const qs = new URLSearchParams({ from, to: from, token: key });
  const start = Date.now();
  try {
    const res = await trackedFetch(
      "finnhub",
      "/calendar/economic",
      `https://finnhub.io/api/v1/calendar/economic?${qs}`,
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
    case "finnhub":
      return finnhubConfigured();
    case "anthropic":
      return anthropicConfigured();
    case "blackout_engine":
      return engineConfigured();
    case "postgres":
      return dbConfigured();
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
  finnhub: probeFinnhub,
  anthropic: async () =>
    anthropicConfigured()
      ? { ok: true, latency_ms: 0, error: null }
      : { ok: false, latency_ms: 0, error: "Not configured" },
  blackout_engine: probeEngine,
  postgres: probePostgres,
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

  const providers: ProviderDashboardRow[] = API_PROVIDER_CATALOG.map((catalog) => {
    const configured = isConfigured(catalog.id);
    const tel = telemetry.by_provider[catalog.id];
    const probe = probeResults.get(catalog.id) ?? {
      ok: false,
      latency_ms: null,
      error: options?.probe ? "Probe skipped" : null,
      at: null,
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
        ok: probe.ok && configured,
        latency_ms: probe.latency_ms,
        error: configured ? probe.error : "Not configured",
        at: probe.at,
      },
      telemetry: {
        calls: tel?.calls ?? 0,
        errors: tel?.errors ?? 0,
        error_rate: tel?.calls ? (tel.errors / tel.calls) * 100 : 0,
      },
    };
  });

  const configuredCount = providers.filter((p) => p.configured).length;
  const healthyCount = providers.filter((p) => p.configured && p.probe.ok).length;

  return {
    generated_at: new Date().toISOString(),
    summary: {
      providers_total: providers.length,
      providers_configured: configuredCount,
      providers_healthy: healthyCount,
      calls_window: telemetry.totals.calls,
      errors_window: telemetry.totals.errors,
      error_rate: telemetry.totals.calls
        ? (telemetry.totals.errors / telemetry.totals.calls) * 100
        : 0,
      window_label: `${Math.round(windowMs / 60_000)}m`,
    },
    providers,
    recent_errors: telemetry.recent_errors,
    recent_events: telemetry.recent_events,
  };
}
