// call_internal_api backing helper — a GOVERNED, GET-only reader of BlackOut's own internal API.
//
// This is how BIE/Largo "reads everything": it can pull any READ endpoint the route-registry marks
// class:"read", but NOTHING else — a non-GET verb, a denied area (admin/cron/auth/webhook/push/
// membership/engine), a cost/LLM route, or an unregistered path is HARD-DENIED before any network
// call. The registry (route-registry.ts) is the single firewall; this module just enforces it and
// fetches. Read-only by construction (GET only).
//
// Not marked `server-only` on purpose so the deny path is unit-testable; it exposes only a governed
// read fetch (no secrets) and is wired solely into run-tool (server).

import { isReadAllowed, routeFor } from "@/lib/route-registry";

export type InternalApiResult = {
  /** Whether the governed fetch succeeded (2xx). A denial or fetch failure is ok:false. */
  ok: boolean;
  path: string;
  status?: number;
  area?: string | null;
  data?: unknown;
  /** Present on a denial / failure. */
  error?: string;
  note?: string;
  detail?: string;
};

/** Base URL for internal fetches — Railway internal, then app URL, then localhost dev. */
function internalBase(): string {
  return (
    process.env.INTERNAL_API_BASE ||
    process.env.RAILWAY_INTERNAL_CRON_BASE ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://127.0.0.1:3000"
  );
}

/**
 * Fetch a governed READ endpoint. Refuses (WITHOUT any network call) anything not GET + class:"read"
 * in the route registry. On an allowed path, GETs the internal URL and returns the parsed body.
 * Never throws — a fetch failure returns a structured error, mirroring every other BIE probe.
 */
export async function callInternalApiRead(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
): Promise<InternalApiResult> {
  if (!path || typeof path !== "string" || !path.startsWith("/api/")) {
    return { ok: false, error: "invalid_path", path: String(path) };
  }
  // THE GATE — read-only + governed. Denied areas / non-GET / mutation / unregistered → refused here.
  if (!isReadAllowed(path, "GET")) {
    return {
      ok: false,
      error: "denied_not_read_allowlisted",
      path,
      note: "call_internal_api only serves GET requests to class:read routes in route-registry.ts",
    };
  }

  let url: URL;
  try {
    url = new URL(path, internalBase());
  } catch {
    return { ok: false, error: "invalid_path", path };
  }
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-bie-internal-read": "1", accept: "application/json" },
    });
    const ctype = res.headers.get("content-type") ?? "";
    const data = ctype.includes("json") ? await res.json() : await res.text();
    return { ok: res.ok, status: res.status, path, area: routeFor(path)?.area ?? null, data };
  } catch (e) {
    return { ok: false, error: "fetch_failed", path, detail: e instanceof Error ? e.message : String(e) };
  }
}
