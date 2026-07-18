/**
 * Shared Postgres helpers for ops audit scripts (cron-audit, ops-collect, validate-deploy).
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

/** SSL config matching db.ts posture for RDS / local dev. */
export function auditPgSsl(connectionString) {
  if (process.env.DATABASE_SSL === "0") return false;
  if (connectionString.includes("localhost") || connectionString.includes("127.0.0.1")) return false;
  const strict = process.env.DATABASE_SSL_STRICT === "1";
  return { rejectUnauthorized: strict };
}

/** Resolve DATABASE_PUBLIC_URL from env. */
export function resolveAuditDbUrl() {
  return (process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL)?.trim() || null;
}

export function createAuditClient(connectionString) {
  return new Client({
    connectionString,
    ssl: auditPgSsl(connectionString),
  });
}
