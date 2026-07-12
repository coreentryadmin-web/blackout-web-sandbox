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
  mergeModeledUnderlay,
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

  // Observed rail: exactly what the live universe recorder captured point-in-time during RTH —
  // genuinely dynamic walls that shift/build/fade with the tape (in-memory + persisted Redis rows).
  const baseHistory = mergeWallHistory(getVectorWallHistory(ticker), persistedHistory);

  // Modeled underlay (product decision 2026-07-12, user-approved). The trail now shows the
  // RECONSTRUCTED session instantly as DIM, clearly-labeled "modeled" beads, which the observed
  // recorded samples above OVERWRITE with solid ones wherever they exist (mergeModeledUnderlay:
  // observed wins its bucket). This gives a member the whole-day wall trail on LOAD for ANY ticker
  // — fresh, off-hours, or non-universe — instead of a 1-dot trail that must build up over many
  // 15s ticks. Crucially it is NOT the earlier #160 bug, where reconstruction was injected into the
  // rail presented AS observed with no distinction: here modeled and observed are visually and
  // textually separated (dim/ghosted + a "modeled vs recorded" legend), so honesty is preserved.
  // reconstructSessionRail is Redis-cached (a past session's bars + EOD chain are final) and never
  // throws — an empty array on any failure degrades gracefully to the observed-only rail.
  const modeledHistory = await reconstructSessionRail({ ticker, sessionYmd }).catch(
    () => [] as WallHistorySample[]
  );
  const combined = mergeModeledUnderlay(baseHistory, modeledHistory);

  // seedWallHistoryForDisplay remains the empty-case fallback (a single as-of-close snapshot when
  // there is genuinely nothing to show); it no-ops here whenever the modeled underlay filled the
  // trail, since it only seeds when history is empty.
  const initialWallHistory = seedWallHistoryForDisplay(
    combined,
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
