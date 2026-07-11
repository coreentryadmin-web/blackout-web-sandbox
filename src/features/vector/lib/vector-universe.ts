import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
} from "@/lib/providers/gex-wall-levels";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { normalizeVectorTicker } from "./vector-ticker";
import { roundFloats } from "@/lib/round-floats";

export type VectorUniverseRow = {
  ticker: string;
  spot: number | null;
  gammaFlip: number | null;
  vexFlip: number | null;
  topCallWall: number | null;
  topPutWall: number | null;
  topCallPct: number | null;
  topPutPct: number | null;
  asOf: number | null;
};

export type VectorUniverseSnapshot = {
  updatedAt: number;
  rows: VectorUniverseRow[];
};

const REDIS_KEY = "vector:universe:snapshot";
/**
 * Serve-stale: the snapshot carries updatedAt for consumers to age-gate, so
 * expiry must not race the 5-min cron (the old 300s TTL was a knife-edge that
 * regularly expired between runs, and after the cron's 21:00 UTC stop EVERY
 * scanner poll from every open tab rebuilt the 21-ticker fan-out inline all
 * evening). 48h keeps weekend reads cache-only; staleness is disclosed, not
 * hidden via expiry.
 */
const TTL_SEC = 48 * 60 * 60;

export async function buildVectorUniverseSnapshot(): Promise<VectorUniverseSnapshot> {
  const tickers = vectorUniverseTickers();
  const rows: VectorUniverseRow[] = [];

  const results = await Promise.allSettled(
    tickers.map(async (raw) => {
      const ticker = normalizeVectorTicker(raw);
      const hm = await fetchGexHeatmap(ticker);
      const spot = hm?.spot ?? null;
      const gexWalls = hm?.gex?.strike_totals
        ? computeGexWalls(mapFromStrikeTotalsRecord(hm.gex.strike_totals))
        : { callWalls: [], putWalls: [] };
      const asOfMs = hm?.asof ? Date.parse(hm.asof) : NaN;
      return {
        ticker,
        spot,
        gammaFlip: hm?.gex?.flip ?? null,
        vexFlip: hm?.vex?.flip ?? null,
        topCallWall: gexWalls.callWalls[0]?.strike ?? null,
        topPutWall: gexWalls.putWalls[0]?.strike ?? null,
        topCallPct: gexWalls.callWalls[0]?.pct ?? null,
        topPutPct: gexWalls.putWalls[0]?.pct ?? null,
        asOf: Number.isFinite(asOfMs) ? asOfMs : null,
      } satisfies VectorUniverseRow;
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") rows.push(r.value);
  }

  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
  // Round at the data layer (repo policy) — topCallPct/topPutPct are raw
  // (abs/total)*100 divisions and spot is a raw provider float.
  return roundFloats({ updatedAt: Date.now(), rows });
}

export async function persistVectorUniverseSnapshot(snap: VectorUniverseSnapshot): Promise<void> {
  await sharedCacheSet(REDIS_KEY, snap, TTL_SEC);
}

export async function loadVectorUniverseSnapshot(): Promise<VectorUniverseSnapshot | null> {
  return sharedCacheGet<VectorUniverseSnapshot>(REDIS_KEY);
}

// In-flight dedup: a cache miss with N concurrent scanner polls must not fan
// out N × 21 heatmap builds.
let refreshInFlight: Promise<VectorUniverseSnapshot> | null = null;

export async function refreshVectorUniverseSnapshot(): Promise<VectorUniverseSnapshot> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const snap = await buildVectorUniverseSnapshot();
    await persistVectorUniverseSnapshot(snap);
    return snap;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
