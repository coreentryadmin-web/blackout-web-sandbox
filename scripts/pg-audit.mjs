/**
 * Shared Postgres helpers for ops audit scripts (cron-audit, ops-collect, validate-deploy).
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

/** SSL config matching db.ts posture for public proxy vs private VPC. */
export function auditPgSsl(connectionString) {
  if (process.env.DATABASE_SSL === "0") return false;
  if (connectionString.includes("localhost") || connectionString.includes("127.0.0.1")) return false;
  if (connectionString.includes(".railway.internal")) return false;
  // Legacy TCP proxy (proxy.rlwy.net) does not negotiate TLS — plain TCP.
  if (connectionString.includes("proxy.rlwy")) return false;
  const strict = process.env.DATABASE_SSL_STRICT === "1";
  return { rejectUnauthorized: strict };
}

/** Resolve DATABASE_PUBLIC_URL from env or production blackout-web variables. */
export function resolveAuditDbUrl() {
  let dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    try {
      const raw = execSync("railway variables --service blackout-web --json 2>/dev/null", {
        encoding: "utf8",
      });
      const vars = JSON.parse(raw);
      dbUrl = vars.DATABASE_PUBLIC_URL || vars.DATABASE_URL;
    } catch {
      /* optional */
    }
  }
  return dbUrl?.trim() || null;
}

export function createAuditClient(connectionString) {
  return new Client({
    connectionString,
    ssl: auditPgSsl(connectionString),
  });
}
