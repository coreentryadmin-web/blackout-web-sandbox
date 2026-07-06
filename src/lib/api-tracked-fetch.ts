import {
  recordApiCall,
  type ApiCallEvent,
  type ApiProviderId,
} from "@/lib/api-telemetry";
import {
  sanitizeTrackedFetchUrl as sanitizeUrl,
  sanitizeHeaderNames,
  sanitizeTelemetrySnippet,
} from "@/lib/api-telemetry-sanitize";

export type TrackedFetchOptions = RequestInit & {
  maxRetries?: number;
  retryDelayMs?: number;
  correlationId?: string;
  /** Overrides DEFAULT_FETCH_TIMEOUT_MS — mainly for tests exercising the timeout path fast. */
  timeoutMs?: number;
};

function headerNames(init?: RequestInit): string[] {
  if (!init?.headers) return [];
  const h = init.headers;
  if (h instanceof Headers) return Array.from(h.keys());
  if (Array.isArray(h)) return h.map(([k]) => k);
  return Object.keys(h);
}

function requestBodyHint(url: string, init?: RequestInit): string | null {
  try {
    const u = new URL(url);
    const qs = u.searchParams.toString();
    let body: string | null = null;
    if (init?.body) {
      body =
        typeof init.body === "string"
          ? init.body.slice(0, 400)
          : "[non-string body]";
    }
    if (qs && body) return `?${qs} | body: ${body}`;
    if (qs) return `?${qs}`;
    return body;
  } catch {
    return null;
  }
}

async function readSnippet(res: Response): Promise<string | null> {
  try {
    const clone = res.clone();
    const text = await clone.text();
    return sanitizeTelemetrySnippet(text.slice(0, 600));
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Bare `fetch()` has no default timeout — a stalled upstream TCP connection (seen live
// against api.massive.com during Polygon GEX-heatmap slowness) hangs the calling request
// indefinitely instead of failing. None of trackedFetch's callers pass their own `signal`,
// so every one of them inherited that hang. 15s is generous versus the ~1-3s p99 for these
// APIs but well under Vercel/Next's own route timeout, so it fails fast without clipping
// legitimately slow-but-healthy responses.
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

// SSRF hardening (request-forgery): `trackedFetch` is the single network-egress choke
// point for every external provider this app calls (Polygon, Unusual Whales, web search,
// the internal blackout_engine, admin health probes). Every caller builds its URL from a
// fixed base plus a caller-supplied ticker/path fragment; per-fragment sanitizers
// (safeTicker/resolveOptionsRoot/etc. — see FINDINGS.md) close the injection at each of
// those call sites, but a future caller could still add a new, unsanitized one. Validating
// the ACTUAL DESTINATION HOST here, once, against a fixed allowlist built ONLY from
// trusted server config (env vars / hardcoded provider hostnames — never from the request
// itself) closes the whole bug class at the one place every flow must pass through: no
// caller can ever reach an unexpected host, regardless of how its path/ticker was built.
function hostnameOf(urlOrBase: string | undefined): string | null {
  if (!urlOrBase) return null;
  try {
    return new URL(urlOrBase).hostname;
  } catch {
    return null;
  }
}

const ALLOWED_FETCH_HOSTS = new Set(
  [
    hostnameOf(process.env.POLYGON_API_BASE) ?? "api.massive.com",
    hostnameOf(process.env.UW_API_BASE) ?? "api.unusualwhales.com",
    // Internal engine base is fully environment-configured (no safe hardcoded default —
    // it varies per deploy), so only allow it when actually set.
    hostnameOf(process.env.API_BASE),
    "api.tavily.com",
    "google.serper.dev",
    "api.search.brave.com",
  ].filter((h): h is string => Boolean(h))
);

/** Test-only escape hatch for local ephemeral test servers (e.g. 127.0.0.1:<random port>
 *  in api-tracked-fetch.test.ts). Never call this from application code — allowlisting a
 *  host here is exactly the control this file exists to enforce everywhere else. */
export function __allowFetchHostForTest(host: string): void {
  ALLOWED_FETCH_HOSTS.add(host);
}

export async function trackedFetch(
  provider: ApiProviderId,
  endpointKey: string,
  url: string,
  init?: TrackedFetchOptions
): Promise<Response> {
  const { maxRetries, retryDelayMs, correlationId, timeoutMs, ...fetchInit } = init ?? {};
  const method = (fetchInit.method ?? "GET").toUpperCase();
  const maxAttempts = Math.max(1, (maxRetries ?? 0) + 1);
  const delayMs = retryDelayMs ?? 2000;
  const corrId = correlationId ?? `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeUrl = sanitizeUrl(url);
  // Strip credential headers (Authorization, X-Blackout-Key, etc.) so they are
  // never persisted in the telemetry DB or SSE stream.
  const headersSent = sanitizeHeaderNames(headerNames(fetchInit));
  // Use the sanitized URL when building the body hint so API keys in the query string
  // are scrubbed BEFORE the hint is stored in the telemetry ring buffer.
  const requestBody = requestBodyHint(safeUrl, fetchInit);

  // Reject before ever calling fetch() if the destination isn't one of this app's known
  // providers — see ALLOWED_FETCH_HOSTS above. Not caught by the retry loop below: an
  // unexpected host is a configuration/injection problem, never a transient failure.
  const destHost = hostnameOf(url);
  if (!destHost || !ALLOWED_FETCH_HOSTS.has(destHost)) {
    throw new Error(`trackedFetch: refusing to fetch disallowed host "${destHost ?? url}"`);
  }

  let lastEvent: ApiCallEvent | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const start = Date.now();
    // Fresh per attempt — an AbortSignal.timeout() fires once and can't be reused across
    // retries. Combine with any caller-supplied signal (via AbortSignal.any) so an explicit
    // caller cancellation/timeout still takes effect; otherwise the default is the only bound.
    const timeoutSignal = AbortSignal.timeout(timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const signal = fetchInit.signal
      ? AbortSignal.any([fetchInit.signal, timeoutSignal])
      : timeoutSignal;
    try {
      const res = await fetch(url, { ...fetchInit, signal });
      const latency_ms = Date.now() - start;
      const snippet = res.ok ? null : await readSnippet(res);
      const rateLimited = res.status === 429;

      lastEvent = recordApiCall({
        provider,
        endpoint: endpointKey,
        method,
        status: res.status,
        ok: res.ok,
        latency_ms,
        error: res.ok ? null : snippet?.slice(0, 200) ?? `HTTP ${res.status}`,
        correlation_id: corrId,
        attempt,
        max_attempts: maxAttempts,
        phase: attempt > 1 ? (res.ok ? "success" : "retry") : res.ok ? "success" : "failure",
        request_url: safeUrl,
        request_body: requestBody,
        response_snippet: snippet,
        rate_limited: rateLimited,
        headers_sent: headersSent,
      });

      if (res.ok || attempt >= maxAttempts) return res;

      if (rateLimited || res.status >= 500) {
        await sleep(delayMs * attempt);
        continue;
      }

      return res;
    } catch (err) {
      const latency_ms = Date.now() - start;
      const message = err instanceof Error ? err.message : "Network error";

      lastEvent = recordApiCall({
        provider,
        endpoint: endpointKey,
        method,
        status: null,
        ok: false,
        latency_ms,
        error: message,
        correlation_id: corrId,
        attempt,
        max_attempts: maxAttempts,
        phase: attempt > 1 ? "retry" : "failure",
        request_url: safeUrl,
        request_body: requestBody,
        response_snippet: null,
        rate_limited: false,
        headers_sent: headersSent,
      });

      if (attempt >= maxAttempts) throw err;
      await sleep(delayMs * attempt);
    }
  }

  throw new Error(lastEvent?.error ?? "Request failed");
}
