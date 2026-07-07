import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { VectorPageShell } from "@/components/vector/VectorPageShell";
import { isEtCashRth } from "@/lib/et-market-hours";
import { todayEt } from "@/lib/nighthawk/session";
import { mergeWallHistory, seedWallHistoryForDisplay } from "@/lib/providers/vector-wall-history";
import { loadSessionWallHistory } from "@/lib/providers/vector-wall-persist";
import { fetchVectorSeedBars } from "@/lib/vector-seed-bars";
import { getVectorGexWalls, getVectorWallHistory } from "@/lib/vector-snapshot";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const metadata: Metadata = {
  title: "Vector · BlackOut",
  description: "Live SPX price action with real-time dark-pool, flow, and GEX level overlays.",
};

export default async function VectorPage() {
  await requireTier("premium");
  if (!(await canAccessTool("vector"))) return <ComingSoon toolKey="vector" />;

  ensureDataSockets();
  const [{ bars, sessionYmd }, walls] = await Promise.all([
    fetchVectorSeedBars(),
    Promise.resolve(getVectorGexWalls()),
  ]);
  const persistedHistory = await loadSessionWallHistory(sessionYmd).catch(
    () => [] as import("@/lib/providers/vector-wall-history").WallHistorySample[]
  );
  const today = todayEt();
  const liveSession = sessionYmd === today && isEtCashRth();
  const initialWallHistory = seedWallHistoryForDisplay(
    mergeWallHistory(getVectorWallHistory(), persistedHistory),
    bars.map((b) => b.time),
    walls,
  );

  return (
    <VectorPageShell
      initialBars={bars}
      initialWalls={walls}
      initialWallHistory={initialWallHistory}
      sessionYmd={sessionYmd}
      liveSession={liveSession}
    />
  );
}
