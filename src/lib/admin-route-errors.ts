import { recordApiCall } from "@/lib/api-telemetry";

const MAX = 40;
const errors: Array<{ route: string; message: string; at: string }> = [];

export function recordAdminRouteError(route: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const at = new Date().toISOString();
  errors.unshift({ route, message, at });
  if (errors.length > MAX) errors.length = MAX;
  console.error(`[${route}]`, error);

  recordApiCall({
    provider: "blackout_engine",
    endpoint: route,
    method: "ROUTE",
    status: 500,
    ok: false,
    latency_ms: 0,
    error: message,
    phase: "failure",
  });
}
export function getAdminRouteErrors(): typeof errors {
  return [...errors];
}
