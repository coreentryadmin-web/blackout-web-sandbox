/**
 * Classify Postgres/PgBouncer errors that are safe to retry once the pool reconnects.
 * PgBouncer surfaces brief backend-login blips as "server login has been failing" — a
 * single retry on a fresh connection usually succeeds (see provider-health-reconcile
 * cron failures in ops issue #242).
 */
export function isTransientPgError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code)
      : "";

  if (/server login has been failing|server_login_retry/i.test(msg)) return true;
  if (/connect failed|connection terminated|Connection terminated/i.test(msg)) return true;
  if (/timeout exceeded|too many clients|remaining connection slots/i.test(msg)) return true;

  const transientCodes = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "57P01", // admin_shutdown
    "53300", // too_many_connections
    "08006", // connection_failure
    "08001", // sqlclient_unable_to_establish_sqlconnection
    "08003", // connection_does_not_exist
  ]);
  if (code && transientCodes.has(code)) return true;

  return false;
}
