/** Reference product cadence — gamma wall bead trail samples (live levels still ~1s). */
export const DEFAULT_WALL_TRAIL_SAMPLE_SEC = 15;

/** Wall-trail bucket size in seconds (env-tunable, min 5s). */
export function wallTrailSampleSec(): number {
  const raw =
    process.env.NEXT_PUBLIC_VECTOR_WALL_TRAIL_SAMPLE_SEC ??
    process.env.VECTOR_WALL_TRAIL_SAMPLE_SEC ??
    DEFAULT_WALL_TRAIL_SAMPLE_SEC;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 5 ? Math.floor(n) : DEFAULT_WALL_TRAIL_SAMPLE_SEC;
}

/** Snap an epoch-second timestamp to the wall-trail bucket (15s by default). */
export function bucketWallSampleTime(
  epochSec: number,
  bucketSec: number = wallTrailSampleSec()
): number {
  if (!Number.isFinite(epochSec)) return epochSec;
  return Math.floor(epochSec / bucketSec) * bucketSec;
}
