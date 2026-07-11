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
  reconstructSessionRail,
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

  // Off-hours dense-rail backfill (task #21). The live universe recorder only
  // writes wall history during RTH for covered tickers, so an off-hours view of
  // a session with no recorded rail (older date, un-covered ticker) would collapse
  // to one seeded bead per strike. When history is sparse and the session is NOT
  // live, reconstruct a REAL dense rail from Polygon's EOD chain + the session's
  // observed spot path (closed-form BSM gamma along the true price path — no
  // fabrication). Redis-cached, so only the first off-hours viewer pays the fetch.
  let baseHistory = mergeWallHistory(getVectorWallHistory(ticker), persistedHistory);
  const SPARSE_RAIL_SAMPLES = 8;
  if (!liveSession && baseHistory.length < SPARSE_RAIL_SAMPLES) {
    const reconstructed = await reconstructSessionRail({ ticker, sessionYmd }).catch(
      () => [] as WallHistorySample[]
    );
    if (reconstructed.length) baseHistory = mergeWallHistory(reconstructed, baseHistory);
  }

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
