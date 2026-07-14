import "server-only";

import { dbConfigured, dbQuery } from "@/lib/db";
import type { WallHistorySample } from "./vector-wall-history";
import { rowToWallSample, type WallRow } from "./vector-wall-db-row";

/**
 * Durable Postgres write-through for the Vector wall-history rail.
 *
 * The rail's hot path is Redis (48h TTL — see vector-wall-persist.ts). This module is the
 * durable mirror: recorder writes fan out here too, and reads fall back here when Redis is
 * cold (restart / eviction). Everything is best-effort — a DB failure must NEVER throw into
 * the live stream, so every export swallows its error and returns a neutral value.
 *
 * server-only: this file must not be pulled into a client bundle. vector-wall-persist.ts (which
 * is reachable from the client-facing feature barrel) imports it via a LAZY dynamic import so
 * this marker never leaks into the browser build. The PURE row mapper lives in the
 * side-effect-free vector-wall-db-row.ts (unit-testable without tripping server-only); it is
 * re-exported here so the module's public surface is unchanged.
 */
export { rowToWallSample } from "./vector-wall-db-row";

/**
 * Upsert ONE bar sample into the durable rail (best-effort). Idempotent per
 * (ticker, session_ymd, bucket_time) so a re-recorded bucket overwrites rather than duplicates.
 * Returns false (never throws) on any guard miss or DB error.
 */
export async function persistWallSampleToDb(
  sessionYmd: string,
  sample: WallHistorySample,
  ticker = "SPX"
): Promise<boolean> {
  if (!sessionYmd || !dbConfigured()) return false;
  try {
    await dbQuery(
      `
      INSERT INTO vector_wall_history
        (ticker, session_ymd, bucket_time, walls, gamma_flip, vex_walls, vex_flip)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)
      ON CONFLICT (ticker, session_ymd, bucket_time) DO UPDATE SET
        walls = EXCLUDED.walls,
        gamma_flip = EXCLUDED.gamma_flip,
        vex_walls = EXCLUDED.vex_walls,
        vex_flip = EXCLUDED.vex_flip,
        updated_at = NOW()
      `,
      [
        ticker,
        sessionYmd,
        sample.time,
        JSON.stringify(sample.walls),
        sample.gammaFlip ?? null,
        sample.vexWalls ? JSON.stringify(sample.vexWalls) : null,
        sample.vexFlip ?? null,
      ]
    );
    return true;
  } catch (err) {
    console.warn(`[vector-wall-db] persist failed ${ticker}:${sessionYmd}:`, err);
    return false;
  }
}

/**
 * Load the durable per-bar rail for a session, ascending by bucket. Returns [] (never throws)
 * on any guard miss or DB error — the caller treats an empty rail as "nothing durable, use Redis".
 */
export async function loadSessionWallHistoryFromDb(
  sessionYmd: string,
  ticker = "SPX"
): Promise<WallHistorySample[]> {
  if (!sessionYmd || !dbConfigured()) return [];
  try {
    const res = await dbQuery<WallRow>(
      `
      SELECT bucket_time, walls, gamma_flip, vex_walls, vex_flip
      FROM vector_wall_history
      WHERE ticker = $1 AND session_ymd = $2
      ORDER BY bucket_time ASC
      `,
      [ticker, sessionYmd]
    );
    return res.rows.map(rowToWallSample);
  } catch (err) {
    console.warn(`[vector-wall-db] load failed ${ticker}:${sessionYmd}:`, err);
    return [];
  }
}

/**
 * BATCH-load the durable rails for MANY sessions in ONE query (GAP A multi-session seed).
 * The per-session loader above costs one round-trip per session; an N-session cold read (Redis
 * only hot-caches ~72h, so most prior sessions always miss) would be N sequential round-trips on
 * the SSR path. `session_ymd = ANY($2)` collapses that to one. Returns a map keyed by session_ymd
 * with each session's samples ascending by bucket; missing sessions are simply absent. Never throws
 * — empty map on any guard miss or DB error, mirroring the single-session loader's degrade contract.
 */
export async function loadSessionsWallHistoryFromDb(
  sessionYmds: string[],
  ticker = "SPX"
): Promise<Map<string, WallHistorySample[]>> {
  const out = new Map<string, WallHistorySample[]>();
  const sessions = sessionYmds.filter(Boolean);
  if (!sessions.length || !dbConfigured()) return out;
  try {
    const res = await dbQuery<WallRow & { session_ymd: string }>(
      `
      SELECT session_ymd, bucket_time, walls, gamma_flip, vex_walls, vex_flip
      FROM vector_wall_history
      WHERE ticker = $1 AND session_ymd = ANY($2)
      ORDER BY session_ymd ASC, bucket_time ASC
      `,
      [ticker, sessions]
    );
    for (const row of res.rows) {
      const list = out.get(row.session_ymd);
      const sample = rowToWallSample(row);
      if (list) list.push(sample);
      else out.set(row.session_ymd, [sample]);
    }
    return out;
  } catch (err) {
    console.warn(`[vector-wall-db] batch load failed ${ticker} (${sessions.length} sessions):`, err);
    return out;
  }
}
