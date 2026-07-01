import { getGexPositioning } from "@/lib/providers/gex-positioning";
import {
  enrichFlowWithGex,
  type GexLevelSnapshot,
} from "@/lib/flow-gex-proximity";

export type { GexProximityLabel, GexLevelSnapshot } from "@/lib/flow-gex-proximity";
export { computeGexProximity, enrichFlowWithGex } from "@/lib/flow-gex-proximity";

const GEX_ENRICH_TIMEOUT_MS = 300;
const GEX_CACHE_TTL_MS = 60_000;

const gexCache = new Map<string, { data: GexLevelSnapshot; expires: number }>();

export async function getGexLevelsForTicker(ticker: string): Promise<GexLevelSnapshot | null> {
  const key = ticker.toUpperCase();
  const cached = gexCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    const pos = await Promise.race([
      getGexPositioning(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GEX_ENRICH_TIMEOUT_MS)),
    ]);
    if (!pos) return null;
    const data: GexLevelSnapshot = {
      flip: pos.flip,
      call_wall: pos.call_wall,
      put_wall: pos.put_wall,
    };
    gexCache.set(key, { data, expires: Date.now() + GEX_CACHE_TTL_MS });
    return data;
  } catch {
    return null;
  }
}

export async function enrichFlowsWithGex<T extends { ticker: string; strike: number }>(
  flows: T[],
  maxTickers = 8
): Promise<Array<T & { gex_proximity?: import("@/lib/flow-gex-proximity").GexProximityLabel }>> {
  const uniqueTickers = [...new Set(flows.map((f) => f.ticker))].slice(0, maxTickers);
  const gexMap = new Map<string, GexLevelSnapshot>();
  await Promise.all(
    uniqueTickers.map(async (t) => {
      const levels = await getGexLevelsForTicker(t);
      if (levels) gexMap.set(t.toUpperCase(), levels);
    })
  );
  return flows.map((f) => {
    const gex = gexMap.get(f.ticker.toUpperCase());
    if (!gex) return f;
    return enrichFlowWithGex(f, gex);
  });
}
