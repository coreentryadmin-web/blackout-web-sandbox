import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { recordWallSample, type WallHistorySample } from "./vector-wall-history";

const KEY_PREFIX = "vector:wall-history";
/** Keep through the next session for off-hours review + replay groundwork. */
const TTL_SEC = 48 * 60 * 60;

function redisKey(ticker: string, sessionYmd: string): string {
  return `${KEY_PREFIX}:${ticker}:${sessionYmd}`;
}

/** Load the durable per-bar wall ladder for a session (shared across replicas). */
export async function loadSessionWallHistory(
  sessionYmd: string,
  ticker = "SPX"
): Promise<WallHistorySample[]> {
  if (!sessionYmd) return [];
  const hit = await sharedCacheGet<WallHistorySample[]>(redisKey(ticker, sessionYmd));
  return hit ?? [];
}

/** Append/replace one bar sample into the session ring (best-effort). */
export async function appendSessionWallSample(
  sessionYmd: string,
  sample: WallHistorySample,
  ticker = "SPX"
): Promise<void> {
  if (!sessionYmd) return;
  try {
    const existing = await loadSessionWallHistory(sessionYmd, ticker);
    const next = recordWallSample(existing, sample);
    await sharedCacheSet(redisKey(ticker, sessionYmd), next, TTL_SEC);
  } catch {
    /* supplementary visual — never block the live stream */
  }
}

/** Debounced Redis persist — one write per 15s bucket per replica (not per SSE connection). */
let lastRedisPersistBucket = -1;
let lastRedisPersistAt = 0;

export function persistWallSampleDebounced(
  sessionYmd: string,
  sample: WallHistorySample,
  ticker = "SPX"
): void {
  if (!sessionYmd) return;
  const now = Date.now();
  const bucket = sample.time;
  if (bucket === lastRedisPersistBucket && now - lastRedisPersistAt < 2_000) return;
  lastRedisPersistBucket = bucket;
  lastRedisPersistAt = now;
  void appendSessionWallSample(sessionYmd, sample, ticker);
}

/** Test-only reset. */
export function _resetWallPersistDebounceForTest(): void {
  lastRedisPersistBucket = -1;
  lastRedisPersistAt = 0;
}
