/**
 * run-migration.ts
 *
 * Utility to apply a SQL migration file against the DB pool.
 * Used by /api/admin/run-migration to apply out-of-band SQL files
 * (e.g. src/lib/migrations/004_god_tier_features.sql) without
 * restarting the app or touching runMigrations() in db.ts.
 *
 * Usage:
 *   import { applyMigrationFile } from "@/lib/run-migration";
 *   await applyMigrationFile("004_god_tier_features.sql");
 */

import fs from "fs/promises";
import path from "path";
import { dbClient } from "@/lib/db";

const MIGRATIONS_DIR = path.join(process.cwd(), "src", "lib", "migrations");

/**
 * Reads a .sql file from src/lib/migrations/ and executes it as a
 * single transaction against the DB pool.
 *
 * @param filename  Bare filename, e.g. "004_god_tier_features.sql"
 * @returns         Object with `ok`, `filename`, and optional `error`.
 */
export async function applyMigrationFile(
  filename: string
): Promise<{ ok: boolean; filename: string; error?: string }> {
  // Safety: only allow .sql files from the known migrations directory.
  if (!filename.endsWith(".sql") || filename.includes("/") || filename.includes("..")) {
    return { ok: false, filename, error: "Invalid filename — must be a bare .sql filename." };
  }

  const filePath = path.join(MIGRATIONS_DIR, filename);
  let sql: string;
  try {
    sql = await fs.readFile(filePath, "utf-8");
  } catch (e: unknown) {
    return {
      ok: false,
      filename,
      error: `Could not read migration file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const client = await dbClient();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    return { ok: true, filename };
  } catch (e: unknown) {
    await client.query("ROLLBACK").catch(() => {});
    return {
      ok: false,
      filename,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    client.release();
  }
}
