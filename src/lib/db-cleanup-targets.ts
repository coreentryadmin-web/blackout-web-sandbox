/**
 * Allow-list of cleanup targets. Keys are table names; values are the set of
 * timestamp columns valid for that table's retention window. SQL identifiers
 * CANNOT be parameterized, so they must be validated against this list.
 */
export const CLEANUP_TARGETS: Readonly<Record<string, readonly string[]>> = {
  api_telemetry_events: ["at"],
  flow_alerts: ["inserted_at"],
  cron_job_runs: ["started_at"],
  spx_signal_log: ["created_at"],
  nighthawk_dossiers_staging: ["created_at"],
  nighthawk_job_log: ["created_at"],
  admin_audit_log: ["created_at"],
  // Signal intelligence tables — long-lived analytics data, generous retention.
  spx_signal_observations: ["observed_at"],
  spx_signal_weight_reports: ["computed_at"],
  // High-write outcome tables — prune CLOSED/RESOLVED rows only (see route.ts guards).
  // Age column for spx is closed_at (NULL while open => open rows never match).
  spx_play_outcomes: ["closed_at"],
  // Age column for nighthawk is created_at; pending/open rows excluded via status guard.
  nighthawk_play_outcomes: ["created_at"],
  // Operational snapshot tables — written frequently during RTH with no prior retention
  // (unbounded growth). Only the most recent row(s) are ever read, so old rows are dead weight.
  market_regime: ["captured_at"],
  flow_anomalies: ["detected_at"],
  coaching_alerts: ["generated_at"],
};

/**
 * Pure, alias-free retention-window resolver for the db-cleanup cron.
 * Reads an env var; falls back to `fallbackDays`; clamps to [floorDays, 3650].
 * The floor guarantees we NEVER prune inside a safe recent window even if an
 * operator misconfigures the env var to a small/invalid value.
 */
export function cleanupRetentionDays(
  envValue: string | undefined,
  fallbackDays: number,
  floorDays = 90,
): number {
  const raw = envValue?.trim();
  const parsed = raw ? Number(raw) : fallbackDays;
  const n = Number.isFinite(parsed) ? Math.round(parsed) : fallbackDays;
  return Math.min(Math.max(n, floorDays), 3650);
}

/**
 * Pure, alias-free predicate: is (table, column) a known cleanup target?
 * hasOwnProperty guard blocks prototype-pollution keys (constructor/__proto__).
 */
export function isAllowedCleanupTarget(table: string, column: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(CLEANUP_TARGETS, table)) return false;
  return CLEANUP_TARGETS[table].includes(column);
}
