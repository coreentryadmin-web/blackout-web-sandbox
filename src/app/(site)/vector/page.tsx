import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import {
  VectorPageShell,
  fetchVectorSeedBars,
  getVectorDarkPoolLevels,
  getVectorGammaFlip,
  getVectorGexWalls,
  getVectorVexFlip,
  getVectorVexWalls,
  getVectorWallHistory,
  loadSessionWallHistory,
  mergeWallHistory,
  normalizeVectorTicker,
  primeVectorWallScope,
  seedWallHistoryForDisplay,
  type WallHistorySample,
} from "@/features/vector";
import { isEtCashRth } from "@/lib/et-market-hours";
import { todayEt } from "@/features/nighthawk/lib/session";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const metadata: Metadata = {
  title: "Vector · BlackOut",
  description: "Live price action with GEX/VEX wall beads, flip levels, and dark-pool overlays.",
};

type PageProps = {
  searchParams: Promise<{ ticker?: string }>;
};

export default async function VectorPage({ searchParams }: PageProps) {
  await requireTier("premium");
  if (!(await canAccessTool("vector"))) return <ComingSoon toolKey="vector" />;

  const { ticker: rawTicker } = await searchParams;
  const ticker = normalizeVectorTicker(rawTicker);

  ensureDataSockets();
  await primeVectorWallScope(ticker);
  const [{ bars, sessionYmd }, walls, vexWalls, gammaFlip, vexFlip, darkPoolLevels] =
    await Promise.all([
      fetchVectorSeedBars(ticker),
      Promise.resolve(getVectorGexWalls(ticker)),
      Promise.resolve(getVectorVexWalls(ticker)),
      getVectorGammaFlip(ticker),
      Promise.resolve(getVectorVexFlip(ticker)),
      getVectorDarkPoolLevels(ticker),
    ]);
  const persistedHistory = await loadSessionWallHistory(sessionYmd, ticker).catch(
    () => [] as WallHistorySample[]
  );
  const today = todayEt();
  const liveSession = sessionYmd === today && isEtCashRth();

  // Time-honest rail (product decision 2026-07-11). The rail shows ONLY what the
  // live universe recorder actually captured point-in-time during RTH — genuinely
  // dynamic walls that shift/build/fade with the tape. We deliberately do NOT
  // back-project the closing chain across the whole session: intraday OI history
  // is not published by any provider (UW/Polygon are EOD-only), so a reconstruction
  // can only replay the CLOSING ladder against the spot path, which paints a flat,
  // full-width rail on a range-bound day (every bucket shows the same strikes at the
  // same strength — proven with a live probe: the 7600 wall read 5.3% at every
  // bucket). That reads as "walls everywhere, all session," the opposite of the
  // point-in-time dynamism the rail is meant to show. Where nothing was recorded,
  // seedWallHistoryForDisplay drops a single honest as-of-close snapshot instead of
  // a fabricated full-day rail. The reconstruction module is kept for the strike×time
  // GEX heatmap (#14), where a dense back-projected grid is the correct primitive.
  const baseHistory = mergeWallHistory(getVectorWallHistory(ticker), persistedHistory);

  const initialWallHistory = seedWallHistoryForDisplay(
    baseHistory,
    bars.map((b) => b.time),
    walls,
    gammaFlip,
    vexWalls,
    vexFlip
  );

  return (
    <VectorPageShell
      ticker={ticker}
      initialBars={bars}
      initialWalls={walls}
      initialVexWalls={vexWalls}
      initialWallHistory={initialWallHistory}
      initialGammaFlip={gammaFlip}
      initialVexFlip={vexFlip}
      initialDarkPoolLevels={darkPoolLevels}
      sessionYmd={sessionYmd}
      liveSession={liveSession}
    />
  );
}
