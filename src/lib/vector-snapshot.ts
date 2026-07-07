import { getCurrentSpxCandle } from "@/lib/ws/spx-candle-store";
import { getGexStrikeExpiryLadder } from "@/lib/ws/uw-socket";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
  nextWallScope,
  type GexWalls,
  type WallScopeState,
} from "@/lib/providers/gex-wall-levels";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { appendSessionWallSample } from "@/lib/providers/vector-wall-persist";
import { recordWallSample, type WallHistorySample } from "@/lib/providers/vector-wall-history";

const WALL_SCOPE_REFRESH_MS = 15_000;
let wallScope: WallScopeState = { expiries: undefined, fetchedAt: 0 };
let wallScopeInFlight: Promise<void> | null = null;
let fallbackStrikeTotals: Record<string, number> | null = null;

const WALLS_CACHE_MS = 900;
let cachedWalls: GexWalls | null = null;
let cachedWallsAt = 0;

function refreshWallScope(): void {
  const now = Date.now();
  if (now - wallScope.fetchedAt < WALL_SCOPE_REFRESH_MS || wallScopeInFlight) return;
  wallScopeInFlight = fetchGexHeatmap("SPX")
    .then((hm) => {
      wallScope = nextWallScope(wallScope, Date.now(), hm);
      if (hm?.gex?.strike_totals && Object.keys(hm.gex.strike_totals).length > 0) {
        fallbackStrikeTotals = hm.gex.strike_totals;
      }
    })
    .catch(() => {
      wallScope = nextWallScope(wallScope, Date.now(), null);
    })
    .finally(() => {
      wallScopeInFlight = null;
    });
}

/** Shared gamma-wall read for Vector SSE + SSR seed (cache-backed, replica-safe fallback). */
export function getVectorGexWalls(): GexWalls | null {
  refreshWallScope();
  const now = Date.now();
  if (now - cachedWallsAt < WALLS_CACHE_MS) return cachedWalls;

  const ws = getGexStrikeExpiryLadder("SPX", wallScope.expiries);
  if (ws) {
    cachedWalls = computeGexWalls(ws.ladder);
  } else if (fallbackStrikeTotals) {
    cachedWalls = computeGexWalls(mapFromStrikeTotalsRecord(fallbackStrikeTotals));
  } else {
    cachedWalls = null;
  }
  cachedWallsAt = now;
  return cachedWalls;
}

export type VectorStreamPayload = {
  candle: ReturnType<typeof getCurrentSpxCandle>["current"];
  walls: GexWalls | null;
  t: number;
  /** Replica-local trail tail so mid-session reloads / SSE connect inherit observed history. */
  wallHistory: WallHistorySample[];
};

// Per-bar wall-level history for the client's historical trail (VectorChart.tsx) — a record of
// where each wall rank actually sat over time, not just its current price. Recorded here
// (rather than purely client-side) so a page load mid-session seeds with what's already been
// observed on this replica instead of starting empty every time the tab reloads. Per-replica
// only (no cross-replica Redis sync, unlike spx-candle-store.ts's current-candle fallback) —
// this is a supplementary visual trail, not a correctness-critical read, so a replica-local gap
// just means a slightly thinner trail on the client that lands on that replica, not wrong data.
let wallHistory: WallHistorySample[] = [];

export function getVectorWallHistory(): WallHistorySample[] {
  return wallHistory;
}

export function buildVectorStreamPayload(): VectorStreamPayload {
  const { current, updatedAt } = getCurrentSpxCandle();
  const walls = getVectorGexWalls();
  if (current && walls) {
    const sample = { time: current.time, walls };
    wallHistory = recordWallSample(wallHistory, sample);
    void appendSessionWallSample(todayEtYmd(), sample);
  }
  return { candle: current, walls, t: updatedAt, wallHistory };
}

/** Test-only reset of module caches. */
export function _resetVectorSnapshotForTest(): void {
  wallScope = { expiries: undefined, fetchedAt: 0 };
  wallScopeInFlight = null;
  fallbackStrikeTotals = null;
  cachedWalls = null;
  cachedWallsAt = 0;
  wallHistory = [];
}
