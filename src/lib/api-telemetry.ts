import type {
  ApiCallEvent,
  ApiEndpointStats,
  ApiCallPhase,
  ApiProviderId,
  ApiRetryStatus,
  ApiIncidentSeverity,
  ProviderHealthRow,
} from "@/lib/api-telemetry-types";
import { classifyEventSeverity } from "@/lib/api-telemetry-types";
import { sanitizeTelemetryBody } from "@/lib/api-telemetry-sanitize";

export type {
  ApiProviderId,
  ApiCallPhase,
  ApiRetryStatus,
  ApiIncidentSeverity,
  ApiCallEvent,
  ApiEndpointStats,
  ProviderHealthRow,
} from "@/lib/api-telemetry-types";
export { classifyEventSeverity, incidentDedupeKey, isFeedableIncident } from "@/lib/api-telemetry-types";

export type ActiveRetry = {
  correlation_id: string;
  provider: ApiProviderId;
  endpoint: string;
  method: string;
  attempt: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  started_at: string;
};

type TelemetryListener = (event: ApiCallEvent) => void;

const MAX_EVENTS = 800;
const events: ApiCallEvent[] = [];
const endpointStats = new Map<string, ApiEndpointStats>();
const activeRetries = new Map<string, ActiveRetry>();
const listeners = new Set<TelemetryListener>();

/**
 * ISO timestamp of when this process started. The in-memory ring buffer
 * only covers events since this moment — data from before the last cold
 * start is not available unless persisted externally.
 */
export const processStartTime = new Date().toISOString();

function statsKey(provider: ApiProviderId, method: string, endpoint: string): string {
  return `${provider}|${method}|${endpoint}`;
}

/**
 * Collapse symbol/date/query cardinality in a provider path to a stable TEMPLATE, so per-ticker
 * / per-OCC paths key into ONE bounded `endpointStats` entry instead of leaking a permanent entry
 * per symbol (audit 03-BACKEND §3.1). Also de-cardinalizes the admin per-endpoint dashboard
 * (a handful of templates, not thousands of one-off symbol rows). The raw path is preserved on
 * each event in the ring buffer — only the aggregated stats are templated.
 */
export function endpointTemplate(endpoint: string): string {
  const path = endpoint.split("?")[0]; // query values (e.g. ticker.any_of=O:...,O:...) are the biggest leak source
  return path
    .replace(/O:[A-Z0-9]+/g, ":occ") // OCC option symbols (O:SPXW250101C05850000)
    .replace(/\b[A-Z]{1,6}\d{6}[CP]\d{8}\b/g, ":occ") // bare OCC (SPXW250101C05850000)
    .replace(/I:[A-Z0-9]+/g, ":idx") // index symbols (I:SPX, I:VIX)
    .replace(/\/ticker\/[^/]+/g, "/ticker/:sym") // /ticker/AAPL -> /ticker/:sym
    .replace(/\d{4}-\d{2}-\d{2}/g, ":date"); // ISO dates in range/aggs paths
}

/**
 * Hard cap on distinct `endpointStats` keys — a backstop LRU eviction in case a non-templated
 * path ever slips through `endpointTemplate`. With templating, real cardinality is small
 * (≈ number of endpoints), so this should never trigger in practice; it just guarantees the
 * Map can never grow unbounded for the process lifetime (the §3.1 leak fix).
 */
const MAX_ENDPOINT_STATS = 500;

let eventSeq = 0;
let globalSeq = 0;

const SLA_MS = 5000;
const MAX_SAMPLES = 100;

function percentile(samples: number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

export function subscribeApiTelemetry(listener: TelemetryListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: ApiCallEvent) {
  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch {
      /* ignore */
    }
  }
}

export function getActiveRetries(): ActiveRetry[] {
  return Array.from(activeRetries.values()).sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
}

export function getApiEventById(id: string): ApiCallEvent | null {
  return events.find((e) => e.id === id) ?? null;
}

export function getApiEventsByCorrelation(correlationId: string): ApiCallEvent[] {
  return events.filter((e) => e.correlation_id === correlationId).reverse();
}

export function getEventsSinceSeq(sinceSeq: number): ApiCallEvent[] {
  return events.filter((e) => e.seq_id > sinceSeq).sort((a, b) => a.seq_id - b.seq_id);
}

export function getLatestSeqId(): number {
  return globalSeq;
}

export function getCallsByProvider1m(): Partial<Record<ApiProviderId, number>> {
  const cutoff = Date.now() - 60_000;
  const counts: Partial<Record<ApiProviderId, number>> = {};
  for (const e of events) {
    if (new Date(e.at).getTime() < cutoff) continue;
    counts[e.provider] = (counts[e.provider] ?? 0) + 1;
  }
  return counts;
}

export function recordApiCall(input: {
  provider: ApiProviderId;
  endpoint: string;
  method: string;
  status: number | null;
  ok: boolean;
  latency_ms: number;
  error?: string | null;
  correlation_id?: string;
  attempt?: number;
  max_attempts?: number;
  retry_status?: ApiRetryStatus;
  phase?: ApiCallPhase;
  request_url?: string;
  request_body?: string | null;
  response_snippet?: string | null;
  rate_limited?: boolean;
  headers_sent?: string[];
  /** Mark non-network events (e.g. admin route catch-blocks) so they are kept out of latency aggregation. */
  synthetic?: boolean;
}): ApiCallEvent {
  const correlation_id = input.correlation_id ?? `${Date.now()}-${++eventSeq}`;
  const attempt = input.attempt ?? 1;
  const max_attempts = input.max_attempts ?? 1;
  const rate_limited = input.rate_limited ?? input.status === 429;
  const latency_ms = Math.round(input.latency_ms);
  const sla_breach = input.ok && latency_ms >= SLA_MS;

  let retry_status: ApiRetryStatus = input.retry_status ?? "none";
  if (!input.ok && attempt < max_attempts && rate_limited) {
    retry_status = "scheduled";
  } else if (!input.ok && attempt >= max_attempts) {
    retry_status = "exhausted";
  } else if (input.ok && attempt > 1) {
    retry_status = "recovered";
  }

  const phase: ApiCallPhase = input.ok
    ? "success"
    : (input.phase ?? (attempt > 1 ? "retry" : "failure"));

  const severity = classifyEventSeverity({ ok: input.ok, status: input.status, rate_limited });

  const event: ApiCallEvent = {
    id: `${Date.now()}-${++eventSeq}`,
    seq_id: ++globalSeq,
    correlation_id,
    provider: input.provider,
    endpoint: input.endpoint,
    method: input.method.toUpperCase(),
    status: input.status,
    ok: input.ok,
    latency_ms,
    error: input.error ?? null,
    at: new Date().toISOString(),
    attempt,
    max_attempts,
    retry_status,
    phase,
    request_url: input.request_url ?? input.endpoint,
    request_body: input.request_body ?? null,
    response_snippet: input.response_snippet ?? null,
    rate_limited,
    headers_sent: input.headers_sent ?? [],
    severity,
    sla_breach,
    synthetic: input.synthetic ?? false,
  };

  if (!input.ok && retry_status === "scheduled") {
    activeRetries.set(correlation_id, {
      correlation_id,
      provider: event.provider,
      endpoint: event.endpoint,
      method: event.method,
      attempt,
      max_attempts,
      next_retry_at: new Date(Date.now() + 2000).toISOString(),
      last_error: event.error,
      started_at: activeRetries.get(correlation_id)?.started_at ?? event.at,
    });
  } else if (input.ok || retry_status === "exhausted") {
    activeRetries.delete(correlation_id);
  }

  events.unshift(event);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;

  // Key stats by the TEMPLATED endpoint so per-ticker / per-OCC paths collapse into one bounded
  // entry instead of leaking a permanent endpointStats row per symbol (audit §3.1).
  const tmplEndpoint = endpointTemplate(event.endpoint);
  const key = statsKey(event.provider, event.method, tmplEndpoint);
  const prev = endpointStats.get(key);
  const call_count = (prev?.call_count ?? 0) + 1;
  const error_count = (prev?.error_count ?? 0) + (event.ok ? 0 : 1);
  // Synthetic events (e.g. admin route catch-blocks) have a fabricated
  // latency_ms of 0 and must not skew the latency distribution. Carry forward
  // the prior latency aggregates while still counting the call/error.
  const avg_latency_ms = event.synthetic
    ? prev?.avg_latency_ms ?? 0
    : prev
      ? Math.round((prev.avg_latency_ms * (call_count - 1) + event.latency_ms) / call_count)
      : event.latency_ms;
  const latency_samples = event.synthetic
    ? prev?.latency_samples ?? []
    : [...(prev?.latency_samples ?? []), event.latency_ms].slice(-MAX_SAMPLES);

  // LRU touch: delete+set re-inserts the key at the end (most-recently-active), so the bounded
  // eviction below removes the LEAST-recently-active endpoint rather than an active one.
  endpointStats.delete(key);
  endpointStats.set(key, {
    endpoint: tmplEndpoint,
    method: event.method,
    call_count,
    error_count,
    last_status: event.status,
    last_latency_ms: event.synthetic ? prev?.last_latency_ms ?? null : event.latency_ms,
    last_ok: event.ok,
    last_at: event.at,
    last_error: event.ok ? prev?.last_error ?? null : event.error,
    avg_latency_ms,
    latency_samples,
    p95_latency_ms: percentile(latency_samples, 95),
    p99_latency_ms: percentile(latency_samples, 99),
  });
  // Backstop the templated key against any residual cardinality — evict the oldest entry so the
  // Map can never grow unbounded for the process lifetime (audit §3.1 leak fix).
  if (endpointStats.size > MAX_ENDPOINT_STATS) {
    const oldest = endpointStats.keys().next().value;
    if (oldest !== undefined) endpointStats.delete(oldest);
  }

  emit(event);
  // Relative (not "@/lib") + .catch: this fires on every recorded API call. The
  // "@/" alias does not resolve in a dynamic import inside the production server
  // chunk, so it threw ERR_MODULE_NOT_FOUND on every call — and being uncaught,
  // each one became an unhandled rejection that spammed the logs.
  void import("./api-telemetry-persist")
    .then(({ persistApiTelemetryEvent }) => persistApiTelemetryEvent(event))
    .catch(() => {
      /* telemetry persistence is best-effort — never throw into the hot path */
    });
  return event;
}

export function getApiTelemetrySnapshot(sinceMs = 5 * 60_000) {
  const cutoff = Date.now() - sinceMs;
  const recent = events.filter((e) => new Date(e.at).getTime() >= cutoff);
  const errors = recent.filter((e) => !e.ok || e.sla_breach).slice(0, 60);

  const byProvider: Record<
    ApiProviderId,
    { calls: number; errors: number; endpoints: ApiEndpointStats[] }
  > = {
    polygon: { calls: 0, errors: 0, endpoints: [] },
    unusual_whales: { calls: 0, errors: 0, endpoints: [] },
    anthropic: { calls: 0, errors: 0, endpoints: [] },
    blackout_engine: { calls: 0, errors: 0, endpoints: [] },
    postgres: { calls: 0, errors: 0, endpoints: [] },
    web_search: { calls: 0, errors: 0, endpoints: [] },
  };

  for (const e of recent) {
    byProvider[e.provider].calls += 1;
    if (!e.ok) byProvider[e.provider].errors += 1;
  }

  for (const [key, stat] of Array.from(endpointStats.entries())) {
    const provider = key.split("|")[0] as ApiProviderId;
    if (byProvider[provider]) {
      byProvider[provider].endpoints.push(stat);
    }
  }

  for (const p of Object.keys(byProvider) as ApiProviderId[]) {
    byProvider[p].endpoints.sort((a, b) => {
      const atA = a.last_at ? new Date(a.last_at).getTime() : 0;
      const atB = b.last_at ? new Date(b.last_at).getTime() : 0;
      return atB - atA;
    });
  }

  return {
    recent_events: recent.slice(0, 120),
    recent_errors: errors,
    active_retries: getActiveRetries(),
    by_provider: byProvider,
    totals: {
      calls: recent.length,
      errors: errors.length,
      window_ms: sinceMs,
    },
    /** ISO timestamp of process start — ring buffer only covers events since this moment. */
    buffer_since: processStartTime,
  };
}

export function buildEventDetail(eventId: string) {
  const event = getApiEventById(eventId);
  if (!event) return null;

  const chain = getApiEventsByCorrelation(event.correlation_id);
  const key = statsKey(event.provider, event.method, endpointTemplate(event.endpoint));
  const stats = endpointStats.get(key) ?? null;

  return {
    event,
    chain,
    endpoint_stats: stats,
    active_retry: activeRetries.get(event.correlation_id) ?? null,
    diagnosis: diagnoseEvent(event),
  };
}

function diagnoseEvent(event: ApiCallEvent): string[] {
  const tips: string[] = [];
  if (event.sla_breach) {
    tips.push(`Slow success — ${event.latency_ms}ms exceeds ${SLA_MS}ms SLA threshold.`);
  }
  if (event.rate_limited || event.status === 429) {
    tips.push("Rate limited — reduce poll frequency or enable caching.");
    if (event.attempt < event.max_attempts) {
      tips.push(`Retry ${event.attempt}/${event.max_attempts} scheduled or in progress.`);
    } else {
      tips.push("All retry attempts exhausted.");
    }
  }
  if (event.status === 403) {
    tips.push("Forbidden — check plan tier / API scope (e.g. volatility add-on).");
  }
  if (event.status === 401) {
    tips.push("Unauthorized — verify API key in .env.local.");
  }
  if (event.status === 404) {
    tips.push("Not found — path template or params may be wrong.");
  }
  if (event.status === 422) {
    tips.push("Validation error — missing or invalid query parameters.");
    if (event.request_body) tips.push(`Request: ${(sanitizeTelemetryBody(event.request_body) ?? "").slice(0, 120)}`);
  }
  if (event.status === null) {
    tips.push("Network failure — DNS, timeout, or connection reset.");
  }
  if (event.provider === "unusual_whales" && !event.ok) {
    tips.push("UW Advanced: check burst limit (120 req/min).");
  }
  if (tips.length === 0 && !event.ok) {
    tips.push("Inspect response snippet below for provider error message.");
  }
  return tips;
}

/** Condensed provider health for /api/market/health and ops dashboards. */
export function getProviderHealthSummary(sinceMs = 5 * 60_000) {
  const cutoff = Date.now() - sinceMs;
  const recent = events.filter((e) => new Date(e.at).getTime() >= cutoff);

  const by_provider: Record<ApiProviderId, ProviderHealthRow> = {
    polygon: emptyProviderRow(),
    unusual_whales: emptyProviderRow(),
    anthropic: emptyProviderRow(),
    blackout_engine: emptyProviderRow(),
    postgres: emptyProviderRow(),
    web_search: emptyProviderRow(),
  };

  const rate_limits: Partial<Record<ApiProviderId, number>> = {};
  const last_calls: Partial<
    Record<ApiProviderId, { endpoint: string; at: string; status: number | null; ok: boolean }>
  > = {};

  for (const e of recent) {
    const row = by_provider[e.provider];
    row.calls_5m += 1;
    if (!e.ok) row.errors_5m += 1;
    if (e.rate_limited || e.status === 429) {
      row.rate_limits_5m += 1;
      rate_limits[e.provider] = (rate_limits[e.provider] ?? 0) + 1;
    }
    const atMs = new Date(e.at).getTime();
    const prevMs = row.last_at ? new Date(row.last_at).getTime() : 0;
    if (atMs >= prevMs) {
      row.last_at = e.at;
      row.last_status = e.status;
      row.last_ok = e.ok;
      row.last_error = e.error;
      row.last_endpoint = e.endpoint;
      last_calls[e.provider] = {
        endpoint: e.endpoint,
        at: e.at,
        status: e.status,
        ok: e.ok,
      };
    }
  }

  return { by_provider, rate_limits, last_calls };
}

function emptyProviderRow(): ProviderHealthRow {
  return {
    calls_5m: 0,
    errors_5m: 0,
    rate_limits_5m: 0,
    last_at: null,
    last_status: null,
    last_ok: true,
    last_error: null,
    last_endpoint: null,
  };
}
