import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { recordWallSample, type WallHistorySample } from "@/lib/providers/vector-wall-history";

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
