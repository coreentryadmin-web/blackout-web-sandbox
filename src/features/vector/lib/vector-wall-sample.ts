import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import { roundFloats } from "@/lib/round-floats";
import type { WallHistorySample } from "./vector-wall-history";
import { VECTOR_ORACLE_TICKERS, normalizeVectorTicker } from "./vector-ticker";
import { hasLiveGexStrikeExpiry } from "@/lib/ws/uw-socket";

/** Reference product cadence — gamma wall bead trail samples (live levels still ~1s). */
export const DEFAULT_WALL_TRAIL_SAMPLE_SEC = 5;

/** Tickers with live UW WS GEX data sample at 5s (real-time, not interpolation). */
export const ORACLE_WALL_TRAIL_SAMPLE_SEC = 5;

const EMPTY_WALLS: GexWalls = { callWalls: [], putWalls: [] };

function hasWalls(w: GexWalls | null | undefined): boolean {
  return Boolean(w && (w.callWalls.length > 0 || w.putWalls.length > 0));
}

/**
 * Build one wall-history sample (bead-rail row) from a heatmap read, or return
 * null when neither lens has walls (nothing to record). Shared by the live SSE
 * hub and the server-side universe recorder so both write byte-identical rows.
 *
 * Contract that keeps the client honest:
 *  - Round ONCE here (repo policy: round at the data layer). A float-precision
 *    delta between the persisted row and a same-bucket live row is exactly what
 *    fabricated phantom flip events on the client's first history merge.
 *  - No carry-forward: a lens with no walls this bucket records an honest gap
 *    (empty walls / null flip), never a copy of the prior reading — stale
 *    readings masquerading as fresh observations poison trails and event diffs.
 */
export function buildWallHistorySample(input: {
  time: number;
  gexWalls: GexWalls | null | undefined;
  gammaFlip: number | null | undefined;
  vexWalls: GexWalls | null | undefined;
  vexFlip: number | null | undefined;
}): WallHistorySample | null {
  const gex = hasWalls(input.gexWalls);
  const vex = hasWalls(input.vexWalls);
  if (!gex && !vex) return null;
  return roundFloats({
    time: input.time,
    walls: gex ? input.gexWalls! : EMPTY_WALLS,
    gammaFlip: gex ? input.gammaFlip ?? null : null,
    vexWalls: vex ? input.vexWalls! : null,
    vexFlip: vex ? input.vexFlip ?? null : null,
  });
}

/** Wall-trail bucket size in seconds (env-tunable, min 5s). Global fallback — prefer wallTrailSampleSecForTicker. */
export function wallTrailSampleSec(): number {
  const raw =
    process.env.NEXT_PUBLIC_VECTOR_WALL_TRAIL_SAMPLE_SEC ??
    process.env.VECTOR_WALL_TRAIL_SAMPLE_SEC ??
    DEFAULT_WALL_TRAIL_SAMPLE_SEC;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 5 ? Math.floor(n) : DEFAULT_WALL_TRAIL_SAMPLE_SEC;
}

/**
 * Ticker-aware bucket interval: tickers with a live UW WS gex_strike_expiry
 * subscription get 5s beads (real-time GEX, not interpolation). Tickers without
 * live WS data stay at 15s (Polygon heatmap REST caches ~8-20s). The static
 * oracle set (SPX/SPY/QQQ) is kept as a floor guarantee — those always get 5s
 * even before the first WS frame lands. An env override wins for all tickers.
 */
export function wallTrailSampleSecForTicker(ticker?: string | null): number {
  const envOverride =
    process.env.NEXT_PUBLIC_VECTOR_WALL_TRAIL_SAMPLE_SEC ??
    process.env.VECTOR_WALL_TRAIL_SAMPLE_SEC;
  if (envOverride != null) {
    const n = Number(envOverride);
    if (Number.isFinite(n) && n >= 5) return Math.floor(n);
  }
  if (ticker) {
    const t = normalizeVectorTicker(ticker);
    if (VECTOR_ORACLE_TICKERS.has(t) || hasLiveGexStrikeExpiry(t)) {
      return ORACLE_WALL_TRAIL_SAMPLE_SEC;
    }
  }
  return DEFAULT_WALL_TRAIL_SAMPLE_SEC;
}

/** Snap an epoch-second timestamp to the wall-trail bucket (15s by default). */
export function bucketWallSampleTime(
  epochSec: number,
  bucketSec: number = wallTrailSampleSec()
): number {
  if (!Number.isFinite(epochSec)) return epochSec;
  return Math.floor(epochSec / bucketSec) * bucketSec;
}
