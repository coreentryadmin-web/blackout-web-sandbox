// get_uw / get_polygon backing readers — governed, read-only pulls from the live UW + Polygon data
// APIs for BIE/Largo. Both go through the providers' OWN base clients (uwReadRaw / polygonReadRaw),
// so the circuit breaker, request-coalescer, rate limiter, and response cache stay IN THE PATH —
// this never bypasses isUwCircuitOpen / polygonTrackedFetch. Read-only by construction (GET only);
// the path allowlist (provider-read-guard.ts) is defense-in-depth against SSRF / off-allowlist paths.

import { uwReadRaw } from "@/lib/providers/unusual-whales";
import { polygonReadRaw } from "@/lib/providers/polygon";
import { isAllowedUwPath, isAllowedPolygonPath, sanitizeProviderPath } from "./provider-read-guard";

export type ProviderReadResult = {
  ok: boolean;
  provider: "unusual_whales" | "polygon";
  endpoint: string;
  data?: unknown;
  error?: string;
  detail?: string;
};

function toStringParams(params?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v != null && v !== "") out[k] = String(v);
  }
  return out;
}

/** Read an allowlisted Unusual Whales data endpoint (GET, cached, rate-limited). */
export async function readUw(endpoint: string, params?: Record<string, unknown>): Promise<ProviderReadResult> {
  const p = sanitizeProviderPath(endpoint);
  if (!p || !isAllowedUwPath(p)) {
    return { ok: false, provider: "unusual_whales", endpoint: String(endpoint), error: "denied_not_allowlisted" };
  }
  try {
    const data = await uwReadRaw(p, toStringParams(params));
    return { ok: true, provider: "unusual_whales", endpoint: p, data };
  } catch (e) {
    return {
      ok: false,
      provider: "unusual_whales",
      endpoint: p,
      error: "provider_error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Read an allowlisted Polygon/Massive data endpoint (GET, rate-limited/tracked). */
export async function readPolygon(endpoint: string, params?: Record<string, unknown>): Promise<ProviderReadResult> {
  const p = sanitizeProviderPath(endpoint);
  if (!p || !isAllowedPolygonPath(p)) {
    return { ok: false, provider: "polygon", endpoint: String(endpoint), error: "denied_not_allowlisted" };
  }
  try {
    const data = await polygonReadRaw(p, toStringParams(params));
    return { ok: true, provider: "polygon", endpoint: p, data };
  } catch (e) {
    return {
      ok: false,
      provider: "polygon",
      endpoint: p,
      error: "provider_error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
