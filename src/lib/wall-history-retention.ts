/**
 * Config + query builder for the wall-history retention cron
 * (`/api/cron/wall-history-retention`).
 *
 * The Vector wall rail is mirrored durably into `vector_wall_history` (one upsert per
 * 15s bucket during RTH). Only a rolling window is ever replayed, so old sessions are
 * pruned daily. Retention is env-driven per the platform decision:
 *   - staging: 30 days (the default here)
 *   - prod:    90 days  → set WALL_HISTORY_RETENTION_DAYS=90 on the prod app
 *
 * NOTE: the nightly `db-cleanup` cron ALSO prunes this table at a hardcoded 90d backstop.
 * The two coexist (both are plain idempotent DELETEs); when both run the tighter window
 * wins. This dedicated job exists so staging can hold a tighter 30d window without
 * lowering db-cleanup's conservative 90d floor for every other table.
 */

/** Staging default. Prod overrides to 90 via WALL_HISTORY_RETENTION_DAYS. */
export const WALL_HISTORY_RETENTION_DEFAULT_DAYS = 30;
/** Hard floor — a misconfigured tiny/zero/negative value can never prune inside a week of replay. */
export const WALL_HISTORY_RETENTION_MIN_DAYS = 7;
/** Hard ceiling — guards against an absurd value that would effectively disable pruning. */
export const WALL_HISTORY_RETENTION_MAX_DAYS = 3650;

/** Table + age column are code-literal constants (never user input) — see db-cleanup allow-list. */
export const WALL_HISTORY_TABLE = "vector_wall_history";
export const WALL_HISTORY_AGE_COLUMN = "updated_at";
/** Rows deleted per statement, so a prune never takes a long lock on a high-write table. */
export const WALL_HISTORY_DELETE_BATCH = 5000;

/**
 * Resolve the retention window (whole days). Reads WALL_HISTORY_RETENTION_DAYS by default,
 * falls back to the staging default, and clamps to [MIN, MAX] so an operator typo
 * (`0`, `-5`, `abc`, `999999`) can neither wipe the table nor disable pruning.
 */
export function wallHistoryRetentionDays(
  envValue: string | undefined = process.env.WALL_HISTORY_RETENTION_DAYS,
): number {
  const raw = envValue?.trim();
  const parsed = raw ? Number(raw) : WALL_HISTORY_RETENTION_DEFAULT_DAYS;
  const n = Number.isFinite(parsed) ? Math.round(parsed) : WALL_HISTORY_RETENTION_DEFAULT_DAYS;
  return Math.min(
    Math.max(n, WALL_HISTORY_RETENTION_MIN_DAYS),
    WALL_HISTORY_RETENTION_MAX_DAYS,
  );
}

/**
 * Build the bounded, batched delete statement. The window (`days`) is parameterized ($1);
 * the batch cap is $2. Deleting by ctid keeps each statement short-lived so the loop can
 * yield between batches. Identifiers are fixed constants (not interpolated user input).
 *
 * Idempotent: re-running against an already-pruned table deletes nothing (the WHERE no
 * longer matches), which is what makes the cron safe to retry / double-fire.
 */
export function buildWallHistoryDeleteQuery(days: number): {
  text: string;
  values: number[];
} {
  if (!Number.isInteger(days) || days < WALL_HISTORY_RETENTION_MIN_DAYS) {
    // Callers must pass a resolved (clamped) window — never a raw/unbounded value.
    throw new Error(
      `Refusing wall-history prune with unsafe window: ${days} (min ${WALL_HISTORY_RETENTION_MIN_DAYS})`,
    );
  }
  const text = `DELETE FROM ${WALL_HISTORY_TABLE}
       WHERE ctid IN (
         SELECT ctid FROM ${WALL_HISTORY_TABLE}
         WHERE ${WALL_HISTORY_AGE_COLUMN} < NOW() - ($1::int || ' days')::interval
         LIMIT $2
       )`;
  return { text, values: [days, WALL_HISTORY_DELETE_BATCH] };
}
