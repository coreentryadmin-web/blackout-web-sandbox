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
  primeVectorWallScope,
  seedWallHistoryForDisplay,
  type WallHistorySample,
} from "@/features/vector";
import { isEtCashRth } from "@/lib/et-market-hours";
import { todayEt } from "@/features/nighthawk/lib/session";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const metadata: Metadata = {
  title: "Vector · BlackOut",
  description: "Live SPX price action with GEX/VEX wall beads, flip levels, and dark-pool overlays.",
};

export default async function VectorPage() {
  await requireTier("premium");
  if (!(await canAccessTool("vector"))) return <ComingSoon toolKey="vector" />;

  ensureDataSockets();
  await primeVectorWallScope();
  const [{ bars, sessionYmd }, walls, vexWalls, gammaFlip, vexFlip, darkPoolLevels] =
    await Promise.all([
      fetchVectorSeedBars(),
      Promise.resolve(getVectorGexWalls()),
      Promise.resolve(getVectorVexWalls()),
      getVectorGammaFlip(),
      Promise.resolve(getVectorVexFlip()),
      Promise.resolve(getVectorDarkPoolLevels()),
    ]);
  const persistedHistory = await loadSessionWallHistory(sessionYmd).catch(
    () => [] as WallHistorySample[]
  );
  const today = todayEt();
  const liveSession = sessionYmd === today && isEtCashRth();
  const initialWallHistory = seedWallHistoryForDisplay(
    mergeWallHistory(getVectorWallHistory(), persistedHistory),
    bars.map((b) => b.time),
    walls,
    gammaFlip,
    vexWalls,
    vexFlip
  );

  return (
    <VectorPageShell
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
