import "server-only";

// BLACKOUT Intelligence Engine — full Vector desk state for BIE/Largo.
//
// This is the Vector analogue of the SPX full-state pattern (spx_full_state /
// getSpxPlayState — see ecosystem-context.ts and load-spx-brief-intel.ts): ONE
// server-side composer that fans out over the SAME reads the Vector chart + desk
// terminal already surface, runs the SAME pure derivers, and attaches the SAME
// `buildVectorPlay` output, so BIE reasons over the entire live Vector surface for
// a ticker+horizon without a second, independently-drifting derivation.
//
// It deliberately REUSES the canonical serializable `VectorSnapshot` contract the
// pure play engine already exports (vector-play-engine.ts) rather than inventing a
// parallel shape — `VectorFullState` is that snapshot plus a small amount of
// desk-only context (options-flow markers, the full per-strike GEX ladder, and a
// compact heatmap-presence summary) that has no slot on the snapshot but that the
// desk brief cites. No new provider calls: every read here is an existing entry the
// stream/route layer already warms, all Redis-cached and fail-open.
//
// Discipline (mirrors fetchEcosystemContext): fail-open to null PER FIELD — a single
// read failing must never blank the whole state or throw — and round every float at
// this data boundary via roundFloats (several Vector reads serve unrounded floats).

import {
  buildVectorPlay,
  type VectorSnapshot,
  type VectorPlay,
} from "@/features/vector/lib/vector-play-engine";
import {
  VECTOR_DEFAULT_DTE_HORIZON,
  type VectorDteHorizon,
} from "@/features/vector/lib/vector-dte-horizon";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import {
  getVectorGexWallsForHorizon,
  getVectorGammaFlipForHorizon,
  getVectorWallHistory,
} from "@/features/vector/lib/vector-snapshot";
import { getHorizonStrikeTotals } from "@/features/vector/lib/vector-dte-walls-server";
import { getVectorMaxPainForHorizon } from "@/features/vector/lib/vector-max-pain-server";
import { getVectorExpectedMove } from "@/features/vector/lib/vector-expected-move-server";
import { getVectorGexHeatmap } from "@/features/vector/lib/vector-gex-heatmap-server";
import { getVectorFlowMarkers, type VectorFlowMarkers } from "@/features/vector/lib/vector-flow-markers-server";
import { buildGexLadder, type GexLadder } from "@/features/vector/lib/vector-gex-ladder";
import { deriveVectorRegime } from "@/features/vector/lib/vector-regime";
import { deriveGammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import { deriveWallProximity } from "@/features/vector/lib/vector-wall-proximity";
import { confluenceZones, type ConfluenceLevel } from "@/features/vector/lib/vector-confluence";
import { scoreTopWalls } from "@/features/vector/lib/vector-wall-integrity";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { roundFloats } from "@/lib/round-floats";

/**
 * Compact presence summary of the strike×time GEX positioning heatmap. The full grid
 * (`GexHeatmapGrid`, ~strikes×times signed-GEX cells) is deliberately NOT carried on the
 * full state: it is large, has no citable scalar the desk brief quotes, and would bloat
 * every BIE turn's context. This tells a consumer the surface is live and its dimensions
 * without shipping the whole matrix — the same "know it exists, don't embed the JSON"
 * spirit the SPX full-state applies to its own heavy payloads.
 */
export type VectorHeatmapSummary = {
  available: boolean;
  /** Strike rows in the horizon-scoped grid. */
  strikeCount: number;
  /** Intraday time columns (the session's real spot path). */
  timeCount: number;
  /** Max |cell| across the grid — the colour-intensity normaliser. */
  maxAbs: number;
};

/**
 * The complete live Vector desk state for one (ticker, horizon). REUSES the canonical
 * `VectorSnapshot` contract (spot / regime / walls / flip / magnet / proximity / expected
 * move / max pain / confluence / wall integrity / technicals / the derived `play`) and
 * ADDS the desk-only context the snapshot has no slot for:
 *  - `asOf`   — when this state was assembled (ISO).
 *  - `flow`   — options-flow markers for the horizon's front expiry (feature #20).
 *  - `ladder` — the full per-strike GEX ladder (king strikes + magnitudes), not just the
 *               top walls the snapshot carries.
 *  - `heatmap`— compact presence summary of the strike×time GEX surface (see above).
 *
 * Every added field is null when its read had nothing real — never fabricated.
 */
export type VectorFullState = VectorSnapshot & {
  asOf: string;
  flow: VectorFlowMarkers | null;
  ladder: GexLadder | null;
  heatmap: VectorHeatmapSummary | null;
};

/**
 * Assemble the full Vector desk state for a ticker + DTE horizon. One `Promise.all` over the
 * existing reads (spot from the SHARED `getGexPositioning` so it can never disagree with the
 * SPX/heatmap surface; horizon-scoped walls / flip / max-pain / expected-move / strike totals /
 * flow), then the pure derivers (regime → magnet/proximity/integrity → confluence), then
 * `buildVectorPlay` to attach the single concrete play. Returns null only when there is no live
 * spot for the ticker (no honest state to state); otherwise degrades field-by-field.
 *
 * `timeframeMin` feeds only the play's invalidation "close" reference label (e.g. "5m" vs "1H");
 * server-side there is no chart timeframe, so it defaults to a 5-minute intraday reference.
 */
export async function fetchVectorFullState(
  ticker: string,
  horizon: VectorDteHorizon = VECTOR_DEFAULT_DTE_HORIZON,
  timeframeMin = 5
): Promise<VectorFullState | null> {
  const t = normalizeVectorTicker(ticker);

  try {
    // Fail-open PER read (mirrors fetchEcosystemContext): most of these already .catch()
    // internally and resolve to null, but wrapping again guarantees one slow/throwing read
    // can never reject the whole fan-out.
    const [positioning, gexWalls, gammaFlip, maxPainRes, expectedMove, strikeTotalsRes, flow] =
      await Promise.all([
        getGexPositioning(t).catch(() => null),
        getVectorGexWallsForHorizon(t, horizon).catch(() => null),
        getVectorGammaFlipForHorizon(t, horizon).catch(() => null),
        getVectorMaxPainForHorizon(t, horizon).catch(() => null),
        getVectorExpectedMove(t, horizon).catch(() => null),
        getHorizonStrikeTotals(t, horizon).catch(() => null),
        getVectorFlowMarkers(t, horizon).catch(() => null),
      ]);

    // Spot is the anchor for every deriver. Prefer the canonical positioning spot (SHARED with
    // SPX and the heatmap), then fall back to the spot the max-pain / expected-move reads
    // returned before giving up — a state with no spot at all is not a real desk read.
    const spot =
      num(positioning?.spot) ?? num(maxPainRes?.spot) ?? num(expectedMove?.spot) ?? null;
    if (spot == null) return null;

    // Heaviest read (session spot path + grid reconstruction) — kept out of the Promise.all so it
    // can't slow the core fan-out, and reduced to a compact summary rather than the full grid.
    const heatmapGrid = await getVectorGexHeatmap(t, horizon, todayEtYmd()).catch(() => null);

    const topCallWall = num(gexWalls?.callWalls?.[0]?.strike);
    const topPutWall = num(gexWalls?.putWalls?.[0]?.strike);

    // Pure derivers — the exact functions the desk terminal already renders, so the BIE read can
    // never describe a different regime/magnet/proximity than a member sees on the chart.
    const regime = deriveVectorRegime({ spot, gammaFlip, topCallWall, topPutWall });
    const magnet = deriveGammaMagnet({ spot, walls: gexWalls, posture: regime.posture });
    const proximity = deriveWallProximity({ spot, walls: gexWalls, gammaFlip });
    // Wall integrity reads the in-memory history rail (persistence factor); an empty rail scores
    // "unknown" (neutral), never a fabricated "held all session" — see scoreWallIntegrity.
    const wallIntegrity = scoreTopWalls(gexWalls, getVectorWallHistory(t));

    const maxPain = num(maxPainRes?.maxPain);
    const ladder = strikeTotalsRes
      ? buildGexLadder(strikeTotalsRes.strikeTotals, strikeTotalsRes.spot)
      : null;

    // Confluence over the INDEPENDENT price levels this state has (walls + flip + max pain). The
    // pure engine only ranks a cluster when ≥2 DISTINCT kinds agree, so a single wall repeated is
    // never mislabeled confluence. Session/technical levels (golden pocket / HOD / LOD / PDH / PDL)
    // are chart-bar-derived and absent server-side — see the `technicals: null` note below.
    const confluenceLevels: ConfluenceLevel[] = [];
    for (const w of gexWalls?.callWalls ?? []) confluenceLevels.push({ price: w.strike, kind: "call-wall" });
    for (const w of gexWalls?.putWalls ?? []) confluenceLevels.push({ price: w.strike, kind: "put-wall" });
    if (gammaFlip != null) confluenceLevels.push({ price: gammaFlip, kind: "gamma-flip" });
    if (maxPain != null) confluenceLevels.push({ price: maxPain, kind: "max-pain" });
    const zones = confluenceZones(confluenceLevels, spot);

    const snapshot: VectorSnapshot = {
      ticker: t,
      horizon,
      timeframeMin,
      spot,
      regime: { posture: regime.posture },
      gexWalls: gexWalls ?? null,
      gammaFlip,
      magnet,
      proximity,
      // getVectorExpectedMove returns `ExpectedMove & { expiry }`; the extra field is harmless and
      // the object is a structural ExpectedMove.
      expectedMove: expectedMove ?? null,
      maxPain,
      confluenceZones: zones,
      wallIntegrity,
      // Server-side there are no displayed chart bars to run summarizeTechnicals over (EMA/VWAP/RSI
      // are computed client-side from the drawn candles), so technicals is honestly null here rather
      // than fabricated. buildVectorPlay degrades gracefully — it keys the play off regime / proximity
      // / walls / magnet, using technicals only as a tie-breaker when present.
      technicals: null,
      bie: null,
    };

    const play: VectorPlay | null = buildVectorPlay(snapshot);

    // roundFloats at the data boundary — several Vector reads serve unrounded floats (documented in
    // CLAUDE.md); rounding once here keeps every downstream brief number clean.
    return roundFloats<VectorFullState>({
      ...snapshot,
      play,
      asOf: new Date().toISOString(),
      flow: flow ?? null,
      ladder,
      heatmap: heatmapGrid
        ? {
            available: true,
            strikeCount: heatmapGrid.strikes.length,
            timeCount: heatmapGrid.times.length,
            maxAbs: heatmapGrid.maxAbs,
          }
        : null,
    });
  } catch {
    return null; // whole-state failure is a no-surface, never a throw into the caller
  }
}

function num(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
