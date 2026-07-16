import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { mergeWallHistory, type WallHistorySample } from "./vector-wall-history";
import type { VectorDteHorizon } from "./vector-dte-horizon";

const KEY_PREFIX = "vector:wall-history";
/** Keep through the next session for off-hours review + replay groundwork. */
// 72h hot-cache (was 48h): bridges weekends so Monday's first reads of Friday rails stay hot.
// LONG-TERM RETENTION IS POSTGRES, NOT THIS TTL — every sample write-throughs to the durable DB
// mirror (no deletion), and loadSessionWallHistory falls back to it and re-warms Redis, so
// 15-day replay reads work regardless of this TTL. Do not bump this to "fix" retention.
const TTL_SEC = 72 * 60 * 60;

/**
 * Storage identity for a (ticker, horizon) rail. Each DTE horizon records its OWN point-in-time
 * trail so 0DTE/weekly/monthly show frozen clusters after close just like "All" — but rather than
 * migrate the schema, a narrowed horizon is stored under a COMPOSITE ticker (`NVDA::weekly`) in
 * both the Redis key and the Postgres `ticker` column. "all" keeps the bare ticker, so every rail
 * recorded before per-horizon history existed (and every "all" read) is byte-for-byte unchanged —
 * fully backward-compatible, no ALTER TABLE, no data backfill.
 */
export function wallRailStorageId(ticker: string, horizon: VectorDteHorizon = "all"): string {
  return horizon === "all" ? ticker : `${ticker}::${horizon}`;
}

function redisKey(storageTicker: string, sessionYmd: string): string {
  return `${KEY_PREFIX}:${storageTicker}:${sessionYmd}`;
}

/**
 * Load the durable per-bar wall ladder for a session (shared across replicas).
 *
 * Redis-first (hot cache). On a Redis miss — cold replica, eviction, restart — fall back to
 * the durable Postgres mirror and, if it has a rail, WARM Redis with it so the next read is hot
 * again. Both the DB module import and the DB call are wrapped so a failure degrades to the
 * legacy Redis-only behaviour (return []) rather than throwing into the caller.
 */
export async function loadSessionWallHistory(
  sessionYmd: string,
  ticker = "SPX",
  horizon: VectorDteHorizon = "all"
): Promise<WallHistorySample[]> {
  if (!sessionYmd) return [];
  const st = wallRailStorageId(ticker, horizon);
  const hit = await sharedCacheGet<WallHistorySample[]>(redisKey(st, sessionYmd));
  if (hit && hit.length) return hit;

  // Redis empty/absent — try the durable Postgres mirror. Lazy dynamic import keeps the
  // server-only DB module out of any client bundle that transitively reaches this file.
  try {
    const { loadSessionWallHistoryFromDb } = await import("./vector-wall-db");
    const durable = await loadSessionWallHistoryFromDb(sessionYmd, st);
    if (durable.length) {
      // Re-warm the hot cache so subsequent reads skip Postgres. Best-effort.
      await sharedCacheSet(redisKey(st, sessionYmd), durable, TTL_SEC).catch(() => {});
      return durable;
    }
  } catch (err) {
    console.warn(`[vector-wall-persist] db fallback failed ${st}:${sessionYmd}:`, err);
  }
  return hit ?? [];
}

/**
 * Append/replace one bar sample into the session ring (best-effort).
 *
 * The write is a read-modify-write with no lock, so with 2+ replicas two
 * writers can interleave — merging by time (union) instead of appending to
 * the tail bounds the damage to "last write for the SAME bucket wins" rather
 * than "whole array from the stale reader wins": a bucket written by replica
 * B can no longer be dropped entirely by replica A writing from a pre-B read,
 * because A's fresh read (immediately before the set) already contains B's
 * bucket and the union preserves it.
 */
export async function appendSessionWallSample(
  sessionYmd: string,
  sample: WallHistorySample,
  ticker = "SPX",
  horizon: VectorDteHorizon = "all"
): Promise<boolean> {
  if (!sessionYmd) return false;
  const st = wallRailStorageId(ticker, horizon);
  try {
    const existing = await loadSessionWallHistory(sessionYmd, ticker, horizon);
    const next = mergeWallHistory(existing, [sample]);
    if (next === existing) return false; // no-op merge — nothing new to write
    await sharedCacheSet(redisKey(st, sessionYmd), next, TTL_SEC);
    // Durable write-through: fan the SAME bucket out to Postgres so the rail survives Redis
    // restarts. Non-blocking and best-effort — Redis stays authoritative for the boolean
    // return, and a DB failure (or the server-only module failing to load in an unexpected
    // context) must not affect the live recorder. Lazy dynamic import keeps the server-only
    // DB module out of any client bundle that transitively reaches this file.
    void (async () => {
      try {
        const { persistWallSampleToDb } = await import("./vector-wall-db");
        await persistWallSampleToDb(sessionYmd, sample, st);
      } catch (err) {
        console.warn(`[vector-wall-persist] db write-through failed ${st}:${sessionYmd}:`, err);
      }
    })();
    return true;
  } catch (err) {
    // Persistence is a supplementary visual and must never block the live stream —
    // but swallowing the error SILENTLY hid a session-long recording gap (an empty
    // off-hours rail) behind a green {ok} cron for hours. Log it so the failure is
    // observable in CloudWatch without changing the non-blocking contract, and
    // return false so callers can tally how many samples actually landed.
    console.warn(`[vector-wall-persist] append failed ${st}:${sessionYmd}:`, err);
    return false;
  }
}

/**
 * Debounced Redis persist — one write per 5s bucket per TICKER per replica.
 * The debounce state was previously module-global: with two tickers streaming
 * concurrently they shared one slot, so within each window only the first
 * ticker's write went through and the others' buckets were permanently missing
 * from persisted history (K tickers → each persists roughly every 2·K seconds).
 */
const lastPersistByTicker = new Map<string, { bucket: number; at: number }>();

export function persistWallSampleDebounced(
  sessionYmd: string,
  sample: WallHistorySample,
  ticker = "SPX",
  horizon: VectorDteHorizon = "all"
): void {
  if (!sessionYmd) return;
  const now = Date.now();
  const bucket = sample.time;
  // Debounce per (ticker, horizon) — each horizon's rail persists independently, so a weekly
  // sample must not be suppressed by a same-bucket "all" write for the same ticker.
  const key = wallRailStorageId(ticker, horizon);
  const last = lastPersistByTicker.get(key);
  if (last && last.bucket === bucket && now - last.at < 2_000) return;
  lastPersistByTicker.set(key, { bucket, at: now });
  void appendSessionWallSample(sessionYmd, sample, ticker, horizon);
}

/** Test-only reset. */
export function _resetWallPersistDebounceForTest(): void {
  lastPersistByTicker.clear();
}
