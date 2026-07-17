/** Runtime env-var presence audit for ECS task environment (values never reported). */

export const CRITICAL_ENV_VARS = [
  "DATABASE_URL",
  "REDIS_URL",
  "ANTHROPIC_API_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "POLYGON_API_KEY",
  "UW_API_KEY",
  "CRON_SECRET",
  "WHOP_API_KEY",
  "WHOP_WEBHOOK_SECRET",
] as const;

export function auditEnvVarKeys(
  keys: string[],
  critical: readonly string[] = CRITICAL_ENV_VARS
): { total_count: number; missing_critical: string[] } {
  const set = new Set(keys);
  return { total_count: keys.length, missing_critical: critical.filter((k) => !set.has(k)) };
}

export type RuntimeEnvAudit = {
  ok: true;
  total_count: number;
  missing_critical: string[];
};

/** Presence-only audit of keys injected into this ECS task. */
export function probeRuntimeEnvVars(): RuntimeEnvAudit {
  const keys = Object.keys(process.env).filter((k) => Boolean(process.env[k]?.trim()));
  return { ok: true, ...auditEnvVarKeys(keys) };
}
