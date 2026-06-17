import { recordApiCall, type ApiProviderId } from "@/lib/api-telemetry";

export async function trackedFetch(
  provider: ApiProviderId,
  endpointKey: string,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const start = Date.now();
  try {
    const res = await fetch(url, init);
    const latency_ms = Date.now() - start;
    recordApiCall({
      provider,
      endpoint: endpointKey,
      method,
      status: res.status,
      ok: res.ok,
      latency_ms,
      error: res.ok ? null : `HTTP ${res.status}`,
    });
    return res;
  } catch (err) {
    const latency_ms = Date.now() - start;
    const message = err instanceof Error ? err.message : "Network error";
    recordApiCall({
      provider,
      endpoint: endpointKey,
      method,
      status: null,
      ok: false,
      latency_ms,
      error: message,
    });
    throw err;
  }
}
