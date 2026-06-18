export type ApiProviderId =
  | "polygon"
  | "unusual_whales"
  | "finnhub"
  | "anthropic"
  | "blackout_engine"
  | "postgres"
  | "web_search";

export type ApiCallPhase = "attempt" | "retry" | "success" | "failure";
export type ApiRetryStatus = "none" | "scheduled" | "in_progress" | "exhausted" | "recovered";

export type ApiCallEvent = {
  id: string;
  correlation_id: string;
  provider: ApiProviderId;
  endpoint: string;
  method: string;
  status: number | null;
  ok: boolean;
  latency_ms: number;
  error: string | null;
  at: string;
  attempt: number;
  max_attempts: number;
  retry_status: ApiRetryStatus;
  phase: ApiCallPhase;
  request_url: string;
  response_snippet: string | null;
  rate_limited: boolean;
  headers_sent: string[];
};

export type ApiEndpointStats = {
  endpoint: string;
  method: string;
  call_count: number;
  error_count: number;
  last_status: number | null;
  last_latency_ms: number | null;
  last_ok: boolean;
  last_at: string | null;
  last_error: string | null;
  avg_latency_ms: number;
};

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

function statsKey(provider: ApiProviderId, method: string, endpoint: string): string {
  return `${provider}|${method}|${endpoint}`;
}

let eventSeq = 0;

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
  response_snippet?: string | null;
  rate_limited?: boolean;
  headers_sent?: string[];
}): ApiCallEvent {
  const correlation_id = input.correlation_id ?? `${Date.now()}-${++eventSeq}`;
  const attempt = input.attempt ?? 1;
  const max_attempts = input.max_attempts ?? 1;
  const rate_limited = input.rate_limited ?? input.status === 429;

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

  const event: ApiCallEvent = {
    id: `${Date.now()}-${++eventSeq}`,
    correlation_id,
    provider: input.provider,
    endpoint: input.endpoint,
    method: input.method.toUpperCase(),
    status: input.status,
    ok: input.ok,
    latency_ms: Math.round(input.latency_ms),
    error: input.error ?? null,
    at: new Date().toISOString(),
    attempt,
    max_attempts,
    retry_status,
    phase,
    request_url: input.request_url ?? input.endpoint,
    response_snippet: input.response_snippet ?? null,
    rate_limited,
    headers_sent: input.headers_sent ?? [],
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

  const key = statsKey(event.provider, event.method, event.endpoint);
  const prev = endpointStats.get(key);
  const call_count = (prev?.call_count ?? 0) + 1;
  const error_count = (prev?.error_count ?? 0) + (event.ok ? 0 : 1);
  const avg_latency_ms = prev
    ? Math.round((prev.avg_latency_ms * (call_count - 1) + event.latency_ms) / call_count)
    : event.latency_ms;

  endpointStats.set(key, {
    endpoint: event.endpoint,
    method: event.method,
    call_count,
    error_count,
    last_status: event.status,
    last_latency_ms: event.latency_ms,
    last_ok: event.ok,
    last_at: event.at,
    last_error: event.ok ? prev?.last_error ?? null : event.error,
    avg_latency_ms,
  });

  emit(event);
  return event;
}

export function getApiTelemetrySnapshot(sinceMs = 5 * 60_000) {
  const cutoff = Date.now() - sinceMs;
  const recent = events.filter((e) => new Date(e.at).getTime() >= cutoff);
  const errors = recent.filter((e) => !e.ok).slice(0, 60);

  const byProvider: Record<
    ApiProviderId,
    { calls: number; errors: number; endpoints: ApiEndpointStats[] }
  > = {
    polygon: { calls: 0, errors: 0, endpoints: [] },
    unusual_whales: { calls: 0, errors: 0, endpoints: [] },
    finnhub: { calls: 0, errors: 0, endpoints: [] },
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
  };
}

export function buildEventDetail(eventId: string) {
  const event = getApiEventById(eventId);
  if (!event) return null;

  const chain = getApiEventsByCorrelation(event.correlation_id);
  const key = statsKey(event.provider, event.method, event.endpoint);
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
