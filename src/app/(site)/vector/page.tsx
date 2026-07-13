import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import {
  VectorPageShell,
  backfillRailPrefix,
  decimateWallHistory,
  fetchVectorSeedBars,
  getVectorDarkPoolLevels,
  getVectorGammaFlip,
  getVectorGexWalls,
  getVectorVexFlip,
  getVectorVexWalls,
  getVectorWallHistory,
  loadMultiSessionWallHistory,
  loadSessionWallHistory,
  mergeWallHistory,
  normalizeVectorTicker,
  primeVectorWallScope,
  PRIOR_SESSION_DECIMATION_STEP_SEC,
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
  const [
    { bars, sessionYmd, sessionYmds, latestSessionStartSec },
    walls,
    vexWalls,
    gammaFlip,
    vexFlip,
    darkPoolLevels,
  ] = await Promise.all([
    fetchVectorSeedBars(ticker),
    Promise.resolve(getVectorGexWalls(ticker)),
    Promise.resolve(getVectorVexWalls(ticker)),
    getVectorGammaFlip(ticker),
    Promise.resolve(getVectorVexFlip(ticker)),
    getVectorDarkPoolLevels(ticker),
  ]);
  // MULTI-DAY RAIL (15-session replay): the latest session loads at full 15s resolution (same
  // read as before — Redis-hot, plus the in-memory hub buffer below); every PRIOR session that
  // has bars loads via the batched Redis→PG multi-session read and is DECIMATED to ~1 sample per
  // 2 minutes with ladders slimmed to the strongest 6 per side. The slim is render-lossless for
  // prior days: every consumer of a NON-latest sample reads at most the top 3 per side (bead
  // dominance filter DOMINANT_WALLS_PER_BUCKET=3, crosshair legend .slice(0,3), replay banner
  // kings [0]) and top-3-by-|pct| of a 6-deep slim equals top-3 of the full 20-deep ladder.
  // Measured (SPX-shaped synthetic, both lenses): undecimated 14 prior sessions ≈ 49MB raw JSON;
  // 2-min step alone ≈ 2.7MB; 2-min + 6/side ≈ 2.1MB raw (~320KB gzip) — vs the pre-existing
  // ~3.5MB raw (~530KB gzip) full-res latest-session rail this page already shipped.
  // Sessions are exactly `sessionYmds` (the sessions with BARS) so beads never land on empty
  // chart space, and rails stay absent (honest gap) for days the recorder never observed.
  const priorSessionYmds = sessionYmds.filter((y) => y !== sessionYmd);
  const [persistedHistory, priorRailRaw] = await Promise.all([
    loadSessionWallHistory(sessionYmd, ticker).catch(() => [] as WallHistorySample[]),
    priorSessionYmds.length
      ? loadMultiSessionWallHistory(ticker, "all", priorSessionYmds).catch(
          () => [] as WallHistorySample[]
        )
      : Promise.resolve([] as WallHistorySample[]),
  ]);
  const priorRail = decimateWallHistory(priorRailRaw, PRIOR_SESSION_DECIMATION_STEP_SEC, {
    maxLevelsPerSide: 6,
  });
  const today = todayEt();
  const liveSession = sessionYmd === today && isEtCashRth();

  // Observed rail first — exactly what the live recorder captured point-in-time during RTH:
  // genuinely dynamic walls that shift/build/fade with the tape (in-memory + persisted Redis/PG
  // rows). `sessionYmd` comes from fetchVectorSeedBars, which walks back to the most recent day
  // that actually HAS price bars — so off-hours (weekend/overnight) this is the last RTH session,
  // and loadSessionWallHistory(sessionYmd) returns THAT session's real recorded beads. The bars
  // and the rail therefore always describe the same sessions and align on the time axis.
  // Merge precedence (mergeWallHistory: remote wins same-bucket ties): prior-day rail first, then
  // the hub's in-memory buffer, then the persisted latest-session rail — the persisted row stays
  // authoritative for today's buckets, exactly as before; prior days never collide (disjoint
  // epoch ranges).
  const combined = mergeWallHistory(
    mergeWallHistory(priorRail, getVectorWallHistory(ticker)),
    persistedHistory
  );

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
  // The reconstruction window is the LATEST session only, so the prefix gap is measured from the
  // latest session's first bar to the first observed sample AT/AFTER it — combined[0] can now be
  // a 14-days-old prior-day sample (multi-day rail), which says nothing about whether TODAY's
  // rail is missing its morning. backfillRailPrefix applies the same at/after-window logic.
  const latestStart = latestSessionStartSec ?? bars[0]?.time;
  const firstObservedInLatest =
    latestStart != null
      ? combined.find((s) => s.time >= latestStart)?.time ?? Number.POSITIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  const needsPrefix =
    bars.length > 0 && latestStart != null && firstObservedInLatest - latestStart > 20 * 60;
  const modeledRail = needsPrefix
    ? await reconstructSessionRail({ ticker, sessionYmd }).catch(() => [] as WallHistorySample[])
    : ([] as WallHistorySample[]);
  const backfilled = backfillRailPrefix(combined, modeledRail, latestStart);

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
