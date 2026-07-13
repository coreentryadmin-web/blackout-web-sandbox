import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
} from "@/lib/providers/gex-wall-levels";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { normalizeVectorTicker } from "./vector-ticker";
import { roundFloats } from "@/lib/round-floats";
import { bucketWallSampleTime, buildWallHistorySample } from "./vector-wall-sample";
import { appendSessionWallSample } from "./vector-wall-persist";
import { VECTOR_WALL_NODES_PER_SIDE } from "./vector-bar-timeframes";
import { buildNarrowedHorizonWallSamples } from "./vector-snapshot";

/**
 * Options for the universe build. `recordWallHistory` makes the build ALSO
 * persist a per-ticker wall-history sample (the bead-rail source the chart
 * reads) — see the recorder note on {@link buildVectorUniverseSnapshot}. Only
 * the RTH-gated cron passes it; the inline scanner-poll rebuild must not, or it
 * would stamp off-hours/weekend samples onto the session rail.
 */
export type VectorUniverseBuildOpts = {
  recordWallHistory?: boolean;
  /** ET session date (YYYY-MM-DD) the recorded samples are filed under. */
  sessionYmd?: string;
};

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
/**
 * Serve-stale: the snapshot carries updatedAt for consumers to age-gate, so
 * expiry must not race the 5-min cron (the old 300s TTL was a knife-edge that
 * regularly expired between runs, and after the cron's 21:00 UTC stop EVERY
 * scanner poll from every open tab rebuilt the 21-ticker fan-out inline all
 * evening). 48h keeps weekend reads cache-only; staleness is disclosed, not
 * hidden via expiry.
 */
const TTL_SEC = 48 * 60 * 60;

/**
 * Build the universe scanner rows — and, when `recordWallHistory` is set,
 * persist a full per-ticker wall-history sample as a SIDE EFFECT of the same
 * heatmap fetch.
 *
 * Why here: the chart's bead rails ("strength per time" dots) are drawn from
 * `vector:wall-history:{ticker}:{ymd}`, but the ONLY writer of that key was the
 * live SSE hub (`buildVectorSnapshot`). So a rail existed only for a ticker a
 * member happened to be watching live during RTH — every other ticker, and the
 * whole session after close, collapsed to the single seeded bead. This build
 * already fetches the full GEX/VEX walls for every universe ticker every 5 min
 * and then throws all but the top strike away; recording a sample from that
 * same data (near-zero extra cost) makes the rails accumulate server-side,
 * independent of viewers, so they persist after-hours and exist for every
 * covered ticker. Kept out of the inline scanner-poll path (opts default off)
 * so off-hours polls can't append stale samples onto the session rail.
 */
export async function buildVectorUniverseSnapshot(
  opts: VectorUniverseBuildOpts = {}
): Promise<VectorUniverseSnapshot> {
  const tickers = vectorUniverseTickers();
  const rows: VectorUniverseRow[] = [];
  const { recordWallHistory = false, sessionYmd } = opts;
  // Snap every ticker's sample to ONE shared bucket for this build so a run
  // produces a single aligned column of beads across strikes (matches the live
  // path's 15s bucketing), not 21 slightly-staggered timestamps.
  const sampleTime = bucketWallSampleTime(Math.floor(Date.now() / 1000));

  const results = await Promise.allSettled(
    tickers.map(async (raw) => {
      const ticker = normalizeVectorTicker(raw);
      const hm = await fetchGexHeatmap(ticker);
      const spot = hm?.spot ?? null;
      const gexWalls = hm?.gex?.strike_totals
        ? computeGexWalls(mapFromStrikeTotalsRecord(hm.gex.strike_totals), {
            maxPerSide: VECTOR_WALL_NODES_PER_SIDE,
          })
        : { callWalls: [], putWalls: [] };
      const vexWalls = hm?.vex?.strike_totals
        ? computeGexWalls(mapFromStrikeTotalsRecord(hm.vex.strike_totals), {
            maxPerSide: VECTOR_WALL_NODES_PER_SIDE,
          })
        : { callWalls: [], putWalls: [] };

      if (recordWallHistory && sessionYmd) {
        const sample = buildWallHistorySample({
          time: sampleTime,
          gexWalls,
          gammaFlip: hm?.gex?.flip ?? null,
          vexWalls,
          vexFlip: hm?.vex?.flip ?? null,
        });
        // Await so the cron only reports success once the rail is durable;
        // append is idempotent (union-by-time) and self-catching.
        if (sample) await appendSessionWallSample(sessionYmd, sample, ticker);

        // Per-horizon rails: record the SAME bucket for 0DTE/weekly/monthly too, via the SHARED
        // recorder the live hub uses. Two behaviour changes vs the old inline loop (both fix the
        // frozen/sparse SPX 0DTE rail): (1) when a horizon's per-expiry reconstruction is empty we
        // FALL BACK to the blended near-term walls (this bucket's fresh reading) instead of dropping
        // the bucket — the documented "null → blended near-term walls" contract; (2) an unexpected
        // throw is surfaced (logged) rather than silently swallowed, so a chronic miss is diagnosable
        // instead of invisible. Still best-effort: never blocks the "all" rail or the scanner row.
        if (spot && spot > 0) {
          const narrowed = await buildNarrowedHorizonWallSamples(ticker, sampleTime, {
            walls: gexWalls,
            flip: hm?.gex?.flip ?? null,
          });
          for (const r of narrowed) {
            if (r.sample) await appendSessionWallSample(sessionYmd, r.sample, ticker, r.horizon);
            else if (r.source === "error") {
              console.warn(
                `[vector-universe] ${ticker} ${r.horizon} narrowed-wall recording threw: ${r.reason ?? "unknown"}`
              );
            }
          }
        }
      }

      const asOfMs = hm?.asof ? Date.parse(hm.asof) : NaN;
      return {
        ticker,
        spot,
        gammaFlip: hm?.gex?.flip ?? null,
        vexFlip: hm?.vex?.flip ?? null,
        topCallWall: gexWalls.callWalls[0]?.strike ?? null,
        topPutWall: gexWalls.putWalls[0]?.strike ?? null,
        topCallPct: gexWalls.callWalls[0]?.pct ?? null,
        topPutPct: gexWalls.putWalls[0]?.pct ?? null,
        asOf: Number.isFinite(asOfMs) ? asOfMs : null,
      } satisfies VectorUniverseRow;
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") rows.push(r.value);
  }

  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
  // Round at the data layer (repo policy) — topCallPct/topPutPct are raw
  // (abs/total)*100 divisions and spot is a raw provider float.
  return roundFloats({ updatedAt: Date.now(), rows });
}

export async function persistVectorUniverseSnapshot(snap: VectorUniverseSnapshot): Promise<void> {
  await sharedCacheSet(REDIS_KEY, snap, TTL_SEC);
}

export async function loadVectorUniverseSnapshot(): Promise<VectorUniverseSnapshot | null> {
  return sharedCacheGet<VectorUniverseSnapshot>(REDIS_KEY);
}

// In-flight dedup: a cache miss with N concurrent scanner polls must not fan
// out N × 21 heatmap builds. Keyed by build kind ("plain" | "record") so the
// non-recording scanner build and the recording cron build dedup separately.
const refreshInFlight = new Map<string, Promise<VectorUniverseSnapshot>>();

export async function refreshVectorUniverseSnapshot(
  opts: VectorUniverseBuildOpts = {}
): Promise<VectorUniverseSnapshot> {
  // In-flight dedup keys on the recorder intent: a scanner poll (no recording)
  // must not be able to satisfy — and thereby cancel the side effect of — the
  // cron's recording build by winning the race. Distinct keys keep at most one
  // build of each kind in flight.
  const key = opts.recordWallHistory ? "record" : "plain";
  const existing = refreshInFlight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const snap = await buildVectorUniverseSnapshot(opts);
    await persistVectorUniverseSnapshot(snap);
    return snap;
  })().finally(() => {
    refreshInFlight.delete(key);
  });
  refreshInFlight.set(key, p);
  return p;
}
