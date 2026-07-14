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
  decimateWallHistory,
  markHistorical,
  mergeWallHistory,
  PRIOR_SESSION_DECIMATION_STEP_SEC,
  seedWallHistoryForDisplay,
  type WallHistorySample,
} from "@/features/vector/lib/vector-wall-history";
import {
  loadMultiSessionWallHistory,
  loadSessionWallHistory,
} from "@/features/vector/lib/vector-wall-persist";
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
  /** Every session included in `initialBars`, ascending (oldest first, last = latest/displayed) —
   *  the exact multi-day window the chart shows. Threaded to VectorChart so the narrowed-horizon
   *  wall-history fetch can request the SAME sessions (GAP A multi-session rail) and beads only ever
   *  land on sessions that actually have candles. */
  initialSessionYmds: string[];
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
  const [{ bars, sessionYmd, sessionYmds, latestSessionStartSec }, walls, vexWalls, gammaFlip, vexFlip, darkPoolLevels] =
    await Promise.all([
      fetchVectorSeedBars(ticker),
      Promise.resolve(getVectorGexWalls(ticker)),
      Promise.resolve(getVectorVexWalls(ticker)),
      getVectorGammaFlip(ticker),
      Promise.resolve(getVectorVexFlip(ticker)),
      getVectorDarkPoolLevels(ticker),
    ]);
  // MULTI-DAY RAIL (GAP A — multi-session bead/wall continuity): the LATEST session loads at full
  // 15s resolution (Redis-hot + the in-memory hub buffer below); every PRIOR session that has bars
  // loads via the batched Redis→PG multi-session read and is DECIMATED to ~1 sample per 2 minutes
  // with ladders slimmed to the strongest 6/side, then tagged `historical` so the chart dims those
  // frozen prior-day clusters vs today's live/forming column. Prior sessions are exactly
  // `sessionYmds` minus the displayed one (the sessions that actually HAVE candles), so beads never
  // land on empty chart space, and rails stay absent (honest gap) for days the recorder never
  // observed — we never fabricate a session's beads. Slim is render-lossless for prior days: every
  // consumer of a non-latest sample reads at most the top 3/side (bead dominance filter
  // DOMINANT_WALLS_PER_BUCKET=3, crosshair legend .slice(0,3), replay banner king [0]).
  const priorSessionYmds = sessionYmds.filter((y) => y !== sessionYmd);
  const [persistedHistory, priorRailRaw] = await Promise.all([
    loadSessionWallHistory(sessionYmd, ticker).catch(() => [] as WallHistorySample[]),
    priorSessionYmds.length
      ? loadMultiSessionWallHistory(ticker, "all", priorSessionYmds).catch(
          () => [] as WallHistorySample[]
        )
      : Promise.resolve([] as WallHistorySample[]),
  ]);
  const priorRail = markHistorical(
    decimateWallHistory(priorRailRaw, PRIOR_SESSION_DECIMATION_STEP_SEC, { maxLevelsPerSide: 6 })
  );
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
  // authoritative for the latest session's buckets, exactly as before; prior days never collide
  // (disjoint epoch ranges).
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
  // First bar of the LATEST session, not bars[0]: the seed carries many sessions, so bars[0] is the
  // OLDEST session's open. The reconstruction (sessionYmd-scoped) and this gap check must describe
  // the DISPLAYED/latest session. `combined` can now LEAD with prior-day samples (multi-day rail),
  // which say nothing about whether TODAY's rail is missing its morning — so measure the first
  // observed sample AT/AFTER the latest session's first bar, never combined[0].
  const firstBar = latestSessionStartSec ?? lastSessionBars(bars)[0]?.time;
  const firstObservedInLatest =
    firstBar != null
      ? combined.find((s) => s.time >= firstBar)?.time ?? Number.POSITIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  const needsPrefix =
    bars.length > 0 && firstBar != null && firstObservedInLatest - firstBar > 20 * 60;
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
    initialSessionYmds: sessionYmds,
    liveSession,
  };
}
