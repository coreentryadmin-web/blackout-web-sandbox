export type ApiProviderId =
  | "polygon"
  | "unusual_whales"
  | "finnhub"
  | "anthropic"
  | "blackout_engine"
  | "postgres";

export type ApiCallEvent = {
  id: string;
  provider: ApiProviderId;
  endpoint: string;
  method: string;
  status: number | null;
  ok: boolean;
  latency_ms: number;
  error: string | null;
  at: string;
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

const MAX_EVENTS = 500;
const events: ApiCallEvent[] = [];
const endpointStats = new Map<string, ApiEndpointStats>();

function statsKey(provider: ApiProviderId, method: string, endpoint: string): string {
  return `${provider}|${method}|${endpoint}`;
}

let eventSeq = 0;

export function recordApiCall(input: {
  provider: ApiProviderId;
  endpoint: string;
  method: string;
  status: number | null;
  ok: boolean;
  latency_ms: number;
  error?: string | null;
}): ApiCallEvent {
  const event: ApiCallEvent = {
    id: `${Date.now()}-${++eventSeq}`,
    provider: input.provider,
    endpoint: input.endpoint,
    method: input.method.toUpperCase(),
    status: input.status,
    ok: input.ok,
    latency_ms: Math.round(input.latency_ms),
    error: input.error ?? null,
    at: new Date().toISOString(),
  };

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

  return event;
}

export function getApiTelemetrySnapshot(sinceMs = 5 * 60_000) {
  const cutoff = Date.now() - sinceMs;
  const recent = events.filter((e) => new Date(e.at).getTime() >= cutoff);
  const errors = recent.filter((e) => !e.ok).slice(0, 40);

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
    recent_events: recent.slice(0, 80),
    recent_errors: errors,
    by_provider: byProvider,
    totals: {
      calls: recent.length,
      errors: errors.length,
      window_ms: sinceMs,
    },
  };
}
