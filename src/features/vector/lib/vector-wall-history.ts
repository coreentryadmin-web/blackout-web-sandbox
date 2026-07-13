import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { VectorTimeframeMinutes } from "./vector-bar-timeframes";
import type { VectorDteHorizon } from "./vector-dte-horizon";

/** Wall overlay lens — GEX from live dealer-gamma ladder; VEX from shared heatmap vanna totals. */
export type VectorWallLens = "gex" | "vex";

export type WallHistorySample = {
  time: number;
  /** GEX (dealer gamma) walls — live via UW WS with heatmap fallback. */
  walls: GexWalls;
  gammaFlip?: number | null;
  /** VEX (dealer vanna) walls — heatmap cache (~8s SPX). Omitted on legacy Redis rows. */
  vexWalls?: GexWalls | null;
  vexFlip?: number | null;
  /**
   * True = this sample was RECONSTRUCTED (modeled from the EOD chain along the observed
   * price path), not OBSERVED by the live recorder. Absent/false = a real recorded sample.
   * Threaded through to the marker layer so modeled beads render dim/ghosted and honestly
   * labeled — a real recorded sample at the same bucket always overwrites it (see
   * mergeModeledUnderlay). Honesty is the whole point: modeled ≠ observed must be visible.
   */
  modeled?: boolean;
};

export function wallsForLens(sample: WallHistorySample, lens: VectorWallLens): GexWalls | null {
  if (lens === "vex") return sample.vexWalls ?? null;
  return sample.walls;
}

export function flipForLens(sample: WallHistorySample, lens: VectorWallLens): number | null {
  const flip = lens === "vex" ? sample.vexFlip : sample.gammaFlip;
  return flip != null && Number.isFinite(flip) && flip > 0 ? flip : null;
}

export function hasVexInHistory(history: WallHistorySample[]): boolean {
  return history.some((s) => Boolean(s.vexWalls?.callWalls?.length || s.vexWalls?.putWalls?.length));
}

export type StrikeTrailPoint = { time: number; pct: number; modeled?: boolean };

// ~one RTH session at 15s trail cadence (390 min × 4 ≈ 1560) plus headroom.
const MAX_HISTORY = 1920;

/** Max simultaneous strike-keyed bead rows per side on the chart (reference shows ~4–6). */
export const MAX_STRIKE_TRAILS_PER_SIDE = 8;

/**
 * How many walls PER SIDE PER BUCKET count as "dominant" and therefore earn a bead that bucket.
 *
 * WHY THIS EXISTS: the recorder stores the full ladder (`VECTOR_WALL_NODES_PER_SIDE` = 20 strikes
 * per side) in every 15s sample. If a trail draws a bead in every bucket where a strike appears
 * ANYWHERE in that 20-deep ladder, then the persistent structural strikes near spot (round numbers
 * that never leave a 20-wide set) get a bead in every bucket → every trail runs full-width from the
 * session open, and a wall that only became dominant intraday is invisible as a "new" wall because
 * it was already sitting in the ladder as a minor member since the open. That is the member report
 * ("SPX had the exact same walls all day — no new walls") and it does NOT match the reference
 * product, where a wall's beads start at the candle it became a real wall and stop/fade when it
 * drops out (Skylit AMD/TSLA/ARM refs: staggered births, gaps, short recent clusters, and only the
 * genuinely persistent levels run full-width).
 *
 * Keeping only each bucket's top-N by |gamma| share restores that: a level that is always among the
 * strongest stays full-width (correctly — it WAS a wall all day), while one that only spikes into
 * the dominant set at 2pm gets a trail born at 2pm. Tracks spot naturally, since gamma concentrates
 * near the money, so walls form where price actually is. 6 matches the reference's ~4–6 visible
 * levels per side without starving the top-N render cap above.
 */
export const DOMINANT_WALLS_PER_BUCKET = 6;

/** Live session: only render wall beads within this many seconds of the chart's leading edge. */
export const LIVE_TRAIL_LOOKBACK_SEC = 45 * 60;

/**
 * Append a wall reading into the session's history, keyed by the trail bucket time (15s by
 * default — see vector-wall-sample.ts). Replaces in place when the bucket is unchanged so
 * magnitude updates within the same 15s window don't duplicate beads.
 */
export function recordWallSample(history: WallHistorySample[], sample: WallHistorySample): WallHistorySample[] {
  const last = history[history.length - 1];
  const next = last && last.time === sample.time ? [...history.slice(0, -1), sample] : [...history, sample];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/**
 * Project the history down to one side's (call or put) rank-`i` trail as plain
 * {time, strike, pct} points — a bar where that rank didn't exist (e.g. the ladder briefly
 * thinned to fewer distinct strikes) is simply omitted, not filled with a placeholder, so the
 * rendered trail has a genuine gap rather than a misleading flat/zero value.
 */
export function trailForRank(
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  rank: number
): Array<{ time: number; strike: number; pct: number }> {
  const points: Array<{ time: number; strike: number; pct: number }> = [];
  for (const sample of history) {
    const level = sample.walls[side][rank];
    if (level) points.push({ time: sample.time, strike: level.strike, pct: level.pct });
  }
  return points;
}

/**
 * Strike-keyed trails — each strike gets its own horizontal bead row (reference product style).
 * When a wall migrates from 7550 → 7575 you see two distinct horizontal trails, not a diagonal
 * scatter from rank-based projection.
 */
export function trailsByStrike(
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  lens: VectorWallLens = "gex",
  dominantPerBucket: number = DOMINANT_WALLS_PER_BUCKET
): Map<number, StrikeTrailPoint[]> {
  const map = new Map<number, StrikeTrailPoint[]>();
  for (const sample of history) {
    const walls = wallsForLens(sample, lens);
    if (!walls) continue;
    // Only this bucket's DOMINANT walls earn a bead — see DOMINANT_WALLS_PER_BUCKET. Sorting by
    // |pct| here (the recorded ladder is stored strike-ordered, not strength-ordered) and slicing
    // to top-N is what gives each wall an HONEST birth: a strike enters its trail at the first
    // bucket it ranks among the strongest, not at the open just because it sat in the wide ladder.
    const dominant =
      dominantPerBucket > 0 && walls[side].length > dominantPerBucket
        ? [...walls[side]].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, dominantPerBucket)
        : walls[side];
    for (const level of dominant) {
      const strike = Math.round(level.strike);
      if (!Number.isFinite(strike)) continue;
      let pts = map.get(strike);
      if (!pts) {
        pts = [];
        map.set(strike, pts);
      }
      const last = pts[pts.length - 1];
      // Carry the sample's modeled flag onto the emitted point so the marker layer can
      // render reconstructed beads dim/ghosted vs solid observed ones (same bucket time).
      if (last?.time === sample.time) {
        pts[pts.length - 1] = { time: sample.time, pct: level.pct, modeled: sample.modeled };
      } else {
        pts.push({ time: sample.time, pct: level.pct, modeled: sample.modeled });
      }
    }
  }
  return map;
}

/** A strike's bead row plus its birth/fade lifecycle metadata (see strikeTrailLifecycle). */
export type StrikeTrail = {
  strike: number;
  points: StrikeTrailPoint[];
  /** First bucket this strike appeared as a wall — the wall's BIRTH candle. */
  bornAt: number;
  /** Most recent bucket this strike was a wall. */
  lastSeen: number;
  /** True when the strike is still in the latest bucket THIS SIDE recorded a wall in — i.e. the
   *  wall is currently forming/holding, not one that has dropped out of the set. */
  active: boolean;
};

/**
 * Per-strike lifecycle view of the bead trails. Each strike carries its birth (first observed
 * bucket), last-seen bucket, and whether it is still in the latest bucket this side recorded.
 *
 * This is the birth→fade contract the chart renders against (BUG 3 — "beat Skylit"): a wall's
 * beads START at its birth candle, never back-filled to the session open (inherited directly
 * from {@link trailsByStrike}, which only records a point in the buckets where the strike is
 * actually a wall — a strike that first entered the set at 14:00 has no point before 14:00),
 * and a wall that has left the set is flagged `active:false` so the marker layer can fade/stop
 * it instead of drawing a stale full-width rail. `active` is computed PER SIDE (against the
 * latest bucket where this side had any wall), so calls being briefly absent from the newest
 * bucket doesn't falsely mark every put as dead, and vice-versa.
 */
export function strikeTrailLifecycle(
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  lens: VectorWallLens = "gex"
): StrikeTrail[] {
  const trails = trailsByStrike(history, side, lens);
  // Latest bucket in which THIS side had any wall — the reference point for "still active".
  let latest = Number.NEGATIVE_INFINITY;
  for (const pts of trails.values()) {
    const tail = pts[pts.length - 1]?.time;
    if (tail != null && tail > latest) latest = tail;
  }
  const out: StrikeTrail[] = [];
  for (const [strike, points] of trails) {
    if (!points.length) continue;
    const lastSeen = points[points.length - 1]!.time;
    out.push({
      strike,
      points,
      bornAt: points[0]!.time,
      lastSeen,
      active: lastSeen === latest,
    });
  }
  return out;
}

/**
 * Weight a strike row for the top-N render cap. Blends PEAK strength with mean, so a wall that
 * is strong RIGHT NOW (or peaked hard) keeps its slot instead of being buried by a weaker wall
 * that merely persisted longer.
 *
 * The old pure-cumulative-sum (`Σ pct`) rewarded longevity alone: an 8%-of-gamma wall that only
 * appeared in the last few samples scored a tiny sum and got dropped, while a 3% wall present all
 * session dominated — so the STRONGEST current wall could be missing from the chart entirely
 * (reported live: the 8% put wall had no beads). Peak-biasing surfaces it.
 */
export function strikeTrailWeight(points: StrikeTrailPoint[]): number {
  if (!points.length) return 0;
  let max = 0;
  let sum = 0;
  for (const p of points) {
    if (p.pct > max) max = p.pct;
    sum += p.pct;
  }
  const mean = sum / points.length;
  return max * 0.6 + mean * 0.4;
}

/** Pick the top-N strike rows to render (by cumulative |gamma| share across the session). */
export function pickActiveStrikes(
  trails: Map<number, StrikeTrailPoint[]>,
  maxStrikes: number = MAX_STRIKE_TRAILS_PER_SIDE
): number[] {
  return [...trails.entries()]
    .sort((a, b) => strikeTrailWeight(b[1]) - strikeTrailWeight(a[1]))
    .slice(0, maxStrikes)
    .map(([strike]) => strike);
}

/** Anchor live trail trimming to the latest candle or wall sample — not wall-clock alone. */
export function liveTrailAnchorSec(
  history: WallHistorySample[],
  barTimes: number[] = []
): number {
  const historyTail = history[history.length - 1]?.time ?? 0;
  const barTail = barTimes.length ? barTimes[barTimes.length - 1]! : 0;
  return Math.max(historyTail, barTail) || Math.floor(Date.now() / 1000);
}

/**
 * Drop wall-history samples older than the live lookback window so migrated strikes do not
 * leave stale horizontal bead rows across the chart all session.
 */
export function trimHistoryForLiveTrails(
  history: WallHistorySample[],
  lookbackSec: number = LIVE_TRAIL_LOOKBACK_SEC,
  anchorSec?: number
): WallHistorySample[] {
  if (!history.length) return history;
  const anchor = anchorSec ?? history[history.length - 1]!.time;
  const cutoff = anchor - lookbackSec;
  return history.filter((s) => s.time >= cutoff);
}

/**
 * Resample the 15s wall-history trail to the active chart interval — one bead per candle
 * bucket (last reading in each bucket wins, same alignment as aggregateVectorBars).
 */
export function bucketWallHistoryForInterval(
  history: WallHistorySample[],
  intervalMinutes: VectorTimeframeMinutes
): WallHistorySample[] {
  if (!history.length) return history;
  const bucketSec = intervalMinutes * 60;
  const map = new Map<number, WallHistorySample>();

  for (const sample of history) {
    const key = Math.floor(sample.time / bucketSec) * bucketSec;
    map.set(key, { ...sample, time: key });
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, sample]) => sample);
}

/**
 * When no per-bar history exists yet (fresh deploy / first page load off-hours), seed ONE
 * honest sample at the last visible candle bar with the current wall ladder — dots land at
 * session close on the right edge of the chart instead of a trail-less void. Does not invent
 * historical points across earlier bars (no GEX time-series source for backfill).
 */
export function seedWallHistoryForDisplay(
  history: WallHistorySample[],
  barTimes: number[],
  walls: GexWalls | null | undefined,
  gammaFlip?: number | null,
  vexWalls?: GexWalls | null,
  vexFlip?: number | null
): WallHistorySample[] {
  if (history.length > 0 || barTimes.length === 0) return history;
  const hasGex = Boolean(walls?.callWalls?.length || walls?.putWalls?.length);
  const hasVex = Boolean(vexWalls?.callWalls?.length || vexWalls?.putWalls?.length);
  if (!hasGex && !hasVex) return history;
  const lastTime = barTimes[barTimes.length - 1]!;
  if (!Number.isFinite(lastTime)) return history;
  return recordWallSample([], {
    time: lastTime,
    walls: walls ?? { callWalls: [], putWalls: [] },
    gammaFlip: gammaFlip ?? null,
    vexWalls: hasVex ? vexWalls : null,
    vexFlip: vexFlip ?? null,
  });
}

/**
 * Bead-trail source for a NARROWED DTE horizon (0DTE/weekly/monthly), or null to signal "use the
 * blended recorded rail instead". The recorded session rail is blended near-term only — there is no
 * per-horizon point-in-time history — so under a narrowed toggle we draw the CURRENT horizon-scoped
 * walls as a single point-in-time column at the latest bar (honest "current 0DTE/weekly/monthly
 * structure"), genuinely distinct from "All". Returns null for the "all" horizon, the VEX lens
 * (no horizon scope), an empty/absent scoped wall set, or a missing bar time — in every such case
 * the caller falls back to the blended rail, so beads never blank on a toggle.
 */
export function narrowedHorizonTrail(
  horizon: VectorDteHorizon,
  lens: VectorWallLens,
  scoped: GexWalls | null | undefined,
  lastBarTime: number,
  flip: number | null | undefined
): WallHistorySample[] | null {
  const hasNodes = Boolean(scoped && (scoped.callWalls.length > 0 || scoped.putWalls.length > 0));
  if (horizon === "all" || lens !== "gex" || !hasNodes || !(lastBarTime > 0)) return null;
  return [{ time: lastBarTime, walls: scoped!, gammaFlip: flip ?? null }];
}

/**
 * Compose the bead trail to draw for a NARROWED DTE horizon from its two sources:
 *   - `recorded`: the durable per-horizon trail (composite-keyed rail, PR #186) — the FROZEN
 *     point-in-time clusters that make weekly/monthly show accumulated beads after close, the
 *     after-hours analogue of the blended "All" rail. Pass null/empty for "all" / the VEX lens /
 *     nothing recorded (the caller owns that gate).
 *   - `current`: {@link narrowedHorizonTrail}'s single current-structure column at the latest bar.
 *
 * Precedence: prefer the recorded trail, but UNION the current column into it (mergeWallHistory,
 * by bucket time) so the newest live structure paints even before the 5-min recorder writes the
 * current bucket — the current column overwrites/extends the recorded tail, never regresses it.
 * With no recorded trail, fall back to the current column alone. With neither, return null so the
 * caller draws the blended "All" rail (beads never blank on a toggle).
 */
export function composeHorizonTrail(
  recorded: WallHistorySample[] | null | undefined,
  current: WallHistorySample[] | null | undefined
): WallHistorySample[] | null {
  if (recorded && recorded.length > 0) {
    return current && current.length > 0 ? mergeWallHistory(recorded, current) : recorded;
  }
  return current && current.length > 0 ? current : null;
}

/**
 * Choose the wall-history rail to REPLAY for a DTE horizon: the recorded per-horizon trail
 * (frozen point-in-time samples, PR #186) when a narrowed GEX horizon has one, else the blended
 * "All" rail the caller passes. This makes replay reconstruct how the SELECTED horizon's clusters
 * built through the session, not always the "All" rail.
 *
 * Unlike {@link composeHorizonTrail} there is deliberately NO current-column union: replay slices
 * this to the cursor and must never surface structure newer than the cursor (the recorded trail is
 * already point-in-time; the live "current" column is future data relative to a past cursor). "all"
 * and the VEX lens (no per-horizon recording) always replay the blended rail.
 */
export function pickReplayTrailSource(
  horizon: VectorDteHorizon,
  lens: VectorWallLens,
  recorded: WallHistorySample[] | null | undefined,
  blended: WallHistorySample[]
): WallHistorySample[] {
  if (horizon !== "all" && lens === "gex" && recorded && recorded.length > 0) return recorded;
  return blended;
}

/** Merge server-observed history into the client buffer — union by bar time, longer tail wins ties. */
export function mergeWallHistory(
  local: WallHistorySample[],
  remote: WallHistorySample[] | null | undefined
): WallHistorySample[] {
  if (!remote?.length) return local;
  if (!local.length) return remote;
  const byTime = new Map<number, WallHistorySample>();
  for (const sample of local) byTime.set(sample.time, sample);
  for (const sample of remote) byTime.set(sample.time, sample);
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return merged.length > MAX_HISTORY ? merged.slice(merged.length - MAX_HISTORY) : merged;
}

/**
 * Compose the instant "modeled underlay" trail with the real recorded rail, keyed by bucket
 * time. Modeled (reconstructed) samples fill the whole session immediately; wherever the live
 * recorder actually OBSERVED a sample, that observed row OVERWRITES the modeled one at the same
 * bucket. Result: a member sees the full-day wall trail on load (dim modeled beads), which solid
 * observed beads replace as/where they exist — honestly labeled modeled vs observed, never the
 * earlier #160 bug where reconstruction was presented AS observed with no distinction.
 *
 * Precedence: insert every modeled sample first (tagged modeled:true), THEN every observed sample
 * (tagged modeled:false) — a later Map.set at the same key wins, so observed always takes its
 * bucket. Empty observed → all-modeled; empty modeled → all-observed. Never throws. Respects the
 * same MAX_HISTORY tail cap as mergeWallHistory.
 */
export function mergeModeledUnderlay(
  observed: WallHistorySample[],
  modeled: WallHistorySample[]
): WallHistorySample[] {
  const byTime = new Map<number, WallHistorySample>();
  for (const sample of modeled ?? []) byTime.set(sample.time, { ...sample, modeled: true });
  // Observed inserted second → overwrites the modeled entry sharing its bucket time.
  for (const sample of observed ?? []) byTime.set(sample.time, { ...sample, modeled: false });
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return merged.length > MAX_HISTORY ? merged.slice(merged.length - MAX_HISTORY) : merged;
}

/** Flip bead trail for the active lens (gamma flip or zero-vanna flip). */
export function trailForFlipLevel(
  history: WallHistorySample[],
  lens: VectorWallLens = "gex"
): Array<{ time: number; strike: number }> {
  const points: Array<{ time: number; strike: number }> = [];
  for (const sample of history) {
    const flip = flipForLens(sample, lens);
    if (flip != null) points.push({ time: sample.time, strike: Math.round(flip) });
  }
  return points;
}

/** @deprecated Use trailForFlipLevel(history, "gex") */
export function trailForGammaFlip(history: WallHistorySample[]): Array<{ time: number; strike: number }> {
  return trailForFlipLevel(history, "gex");
}
