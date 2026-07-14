import "server-only";
import { isEtCashRth } from "@/lib/et-market-hours";
import { todayEt } from "@/features/nighthawk/lib/session";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import type { VectorBar } from "@/features/vector/components/VectorChart";
import type { VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import { fetchVectorSeedBars } from "@/features/vector/lib/vector-seed-bars";
import { lastSessionBars } from "@/features/vector/lib/vector-key-levels";
import {
  getVectorDarkPoolLevels,
  getVectorGammaFlip,
  getVectorGexWalls,
  getVectorVexFlip,
  getVectorVexWalls,
  getVectorWallHistory,
  primeVectorWallScope,
} from "@/features/vector/lib/vector-snapshot";
import {
  backfillRailPrefix,
  mergeWallHistory,
  seedWallHistoryForDisplay,
  type WallHistorySample,
} from "@/features/vector/lib/vector-wall-history";
import { loadSessionWallHistory } from "@/features/vector/lib/vector-wall-persist";
import { reconstructSessionRail } from "@/features/vector/lib/vector-gex-reconstruct-server";

/** Server-seeded props consumed by VectorPageShell (SSR snapshot for first paint). */
export type VectorSeedProps = {
  ticker: string;
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialVexWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  initialGammaFlip: number | null;
  initialVexFlip: number | null;
  initialDarkPoolLevels: VectorDarkPoolLevel[];
  sessionYmd: string;
  liveSession: boolean;
};

/**
 * ONE server-side seed loader for every surface that embeds Vector (the /vector page AND the
 * SPX Slayer flagship dashboard). Extracted from the /vector page (2026-07-13, member-directed
 * desk consolidation) so the two entry points can never drift: same bars, same wall scope, same
 * observed-rail merge + modeled-prefix backfill + empty-case seeding on both routes.
 *
 * `ticker` must already be normalized (normalizeVectorTicker) by the caller.
 */
export async function loadVectorSeedProps(ticker: string): Promise<VectorSeedProps> {
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

  // Observed rail first — exactly what the live recorder captured point-in-time during RTH:
  // genuinely dynamic walls that shift/build/fade with the tape (in-memory + persisted Redis/PG
  // rows). `sessionYmd` comes from fetchVectorSeedBars, which walks back to the most recent day
  // that actually HAS price bars — so off-hours (weekend/overnight) this is the last RTH session,
  // and loadSessionWallHistory(sessionYmd) returns THAT session's real recorded beads. The bars
  // and the rail therefore always describe the same session and align on the time axis.
  const combined = mergeWallHistory(getVectorWallHistory(ticker), persistedHistory);

  // UNIVERSE PARITY (2026-07-13, user-directed): Vector must behave the same for EVERY optionable
  // ticker, not just the pre-recorded ~20-name universe. A ticker with no viewer has no recorded
  // rail before its first view, so the first member of the day saw single beads. Backfill ONLY the
  // missing PREFIX (before the first observed sample) from the reconstruction: today's published OI
  // with gamma recomputed along the session's REAL spot path — genuinely time-varying, and now
  // rendered through the per-bucket DOMINANCE filter so it shows honest staggered births, not the
  // flat axis-to-axis underlay that got the model removed on 2026-07-12 (that flatness was the
  // dominance bug, since fixed). Modeled beads draw as faint ghosts (MODELED_ALPHA_SCALE) under
  // solid observed ones, and the model never overwrites or extends past a real sample — a member
  // can always tell recorded structure from reconstructed context. Redis-cached per ticker+session;
  // best-effort (a reconstruction failure just leaves the honest gap).
  const firstObserved = combined[0]?.time ?? Number.POSITIVE_INFINITY;
  // First bar of the LATEST session, not bars[0]: the seed now carries ~3 sessions, so bars[0]
  // is the OLDEST session's open. Comparing today's first observed rail sample against a
  // two-days-ago open made the "rail starts late" gap check trivially true on every load,
  // firing the reconstruction fetch even when the observed rail already covered the session
  // from its open. The rail, the reconstruction (sessionYmd-scoped), and this gap check must
  // all describe the SAME (displayed/latest) session.
  const firstBar = lastSessionBars(bars)[0]?.time;
  const needsPrefix =
    bars.length > 0 && firstBar != null && firstObserved - firstBar > 20 * 60;
  const modeledRail = needsPrefix
    ? await reconstructSessionRail({ ticker, sessionYmd }).catch(() => [] as WallHistorySample[])
    : ([] as WallHistorySample[]);
  const backfilled = backfillRailPrefix(combined, modeledRail, firstBar);

  // Empty-case fallback: a single as-of-close snapshot at the last bar when there is genuinely
  // nothing recorded OR reconstructable for this session. No-ops whenever the rail already has
  // samples. Never a full-day fabrication.
  const initialWallHistory = seedWallHistoryForDisplay(
    backfilled,
    bars.map((b) => b.time),
    walls,
    gammaFlip,
    vexWalls,
    vexFlip
  );

  return {
    ticker,
    initialBars: bars,
    initialWalls: walls,
    initialVexWalls: vexWalls,
    initialWallHistory,
    initialGammaFlip: gammaFlip,
    initialVexFlip: vexFlip,
    initialDarkPoolLevels: darkPoolLevels,
    sessionYmd,
    liveSession,
  };
}
