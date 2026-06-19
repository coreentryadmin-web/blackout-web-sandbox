import {
  recordApiCall,
  type ApiCallEvent,
  type ApiProviderId,
} from "@/lib/api-telemetry";
import { sanitizeTrackedFetchUrl as sanitizeUrl } from "@/lib/api-telemetry-sanitize";

export type TrackedFetchOptions = RequestInit & {
  maxRetries?: number;
  retryDelayMs?: number;
  correlationId?: string;
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
    return text.slice(0, 600) || null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function trackedFetch(
  provider: ApiProviderId,
  endpointKey: string,
  url: string,
  init?: TrackedFetchOptions
): Promise<Response> {
  const { maxRetries, retryDelayMs, correlationId, ...fetchInit } = init ?? {};
  const method = (fetchInit.method ?? "GET").toUpperCase();
  const maxAttempts = Math.max(1, (maxRetries ?? 0) + 1);
  const delayMs = retryDelayMs ?? 2000;
  const corrId = correlationId ?? `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeUrl = sanitizeUrl(url);
  const headersSent = headerNames(fetchInit);
  const requestBody = requestBodyHint(url, fetchInit);

  let lastEvent: ApiCallEvent | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const start = Date.now();
    try {
      const res = await fetch(url, fetchInit);
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
