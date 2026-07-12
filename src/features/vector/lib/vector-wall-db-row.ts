import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "./vector-wall-history";

/**
 * PURE row-mapping for the durable Vector wall-history rail.
 *
 * Split out of vector-wall-db.ts (which is `import "server-only"`) so the mapper can be unit
 * tested with a plain `tsx --test` run: importing the server-only module directly throws
 * ("cannot be imported from a Client Component"), so the test targets THIS side-effect-free
 * file instead. vector-wall-db.ts re-exports `rowToWallSample` so its public surface is
 * unchanged for real (server) callers.
 */

export type WallRow = {
  bucket_time: number | string | bigint;
  walls: GexWalls | string;
  gamma_flip: number | null;
  vex_walls: GexWalls | string | null;
  vex_flip: number | null;
};

/** pg returns jsonb as an already-parsed object, but tolerate a string just in case. */
function asWalls(value: GexWalls | string | null): GexWalls | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as GexWalls;
    } catch {
      return null;
    }
  }
  return value;
}

/**
 * DB row → sample mapper. bucket_time is a BIGINT and pg may hand it back as a string, so
 * coerce with Number(); null gamma/vex columns map to nulls (legacy rows never had vex).
 */
export function rowToWallSample(row: WallRow): WallHistorySample {
  return {
    time: Number(row.bucket_time),
    walls: (asWalls(row.walls) ?? { callWalls: [], putWalls: [] }) as GexWalls,
    gammaFlip: row.gamma_flip ?? null,
    vexWalls: asWalls(row.vex_walls),
    vexFlip: row.vex_flip ?? null,
  };
}
