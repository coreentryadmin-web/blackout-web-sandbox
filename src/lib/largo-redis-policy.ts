// Pure policy for Largo's Redis dependency (audit F-1 / F-3).
// No @/lib imports — unit-testable under tsx --test.

/**
 * When true (default), Largo rejects new queries with 503 if Redis is unavailable,
 * instead of running unbounded Claude tool-loops with no per-user budget gate.
 * Set LARGO_REDIS_FAILOPEN=1 to restore the legacy fail-open + local backstop path
 * (useful for local dev without Redis).
 */
export function largoFailClosedWithoutRedis(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.LARGO_REDIS_FAILOPEN ?? "").trim().toLowerCase();
  return !(raw === "1" || raw === "true" || raw === "yes" || raw === "on");
}

/** True when the route must reject before doing any AI work. */
export function shouldRejectLargoWithoutRedis(
  redisAvailable: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !redisAvailable && largoFailClosedWithoutRedis(env);
}
