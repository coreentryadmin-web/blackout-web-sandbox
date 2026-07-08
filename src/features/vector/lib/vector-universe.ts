import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
} from "@/lib/providers/gex-wall-levels";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { normalizeVectorTicker } from "./vector-ticker";

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
const TTL_SEC = 300;

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
      return {
        ticker,
        spot,
        gammaFlip: hm?.gex?.flip ?? null,
        vexFlip: hm?.vex?.flip ?? null,
        topCallWall: gexWalls.callWalls[0]?.strike ?? null,
        topPutWall: gexWalls.putWalls[0]?.strike ?? null,
        topCallPct: gexWalls.callWalls[0]?.pct ?? null,
        topPutPct: gexWalls.putWalls[0]?.pct ?? null,
        asOf: hm?.asof ? Date.parse(hm.asof) : null,
      } satisfies VectorUniverseRow;
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") rows.push(r.value);
  }

  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { updatedAt: Date.now(), rows };
}

export async function persistVectorUniverseSnapshot(snap: VectorUniverseSnapshot): Promise<void> {
  await sharedCacheSet(REDIS_KEY, snap, TTL_SEC);
}

export async function loadVectorUniverseSnapshot(): Promise<VectorUniverseSnapshot | null> {
  return sharedCacheGet<VectorUniverseSnapshot>(REDIS_KEY);
}

export async function refreshVectorUniverseSnapshot(): Promise<VectorUniverseSnapshot> {
  const snap = await buildVectorUniverseSnapshot();
  await persistVectorUniverseSnapshot(snap);
  return snap;
}
