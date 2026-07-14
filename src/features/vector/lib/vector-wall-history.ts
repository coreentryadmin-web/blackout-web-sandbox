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
  /**
   * True = this sample belongs to a PRIOR trading session (not the latest/current one) in a
   * MULTI-DAY rail (GAP A — "if a stock was open yesterday, today's chart should show yesterday's
   * beads/walls"). Threaded to the marker layer so prior-session clusters render dimmer/smaller —
   * visually distinguished from today's live/forming column — while staying honest recorded data
   * (distinct from `modeled`, which means reconstructed/not-observed). Absent/false = latest session.
   */
  historical?: boolean;
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

/**
 * Should a gap between two consecutive bead-trail points render a REBIRTH cue (wall died and
 * re-formed)? True only for an INTRADAY gap: longer than 2 candle intervals (honest single-bucket
 * jitter isn't a death) but shorter than a session break — the overnight gap in a multi-day rail is
 * market closure, not a wall dying and being reborn, so boosting the first bucket of every new day
 * would spray one fake "wall re-formed" cue per strike per session boundary.
 */
export function isRebirthGap(gapSec: number, intervalSec: number): boolean {
  return gapSec > intervalSec * 2 && gapSec < SESSION_GAP_SEC;
}

/**
 * Suffix of a multi-day rail belonging to the LATEST session — everything after the last
 * session-sized gap. Session-relative consumers (wall-integrity's "held N% of session") must score
 * against THIS, not the whole multi-day buffer, or a wall that held ALL of today would read as
 * "held 7% of session" because N other days diluted the denominator. A single-session rail (no gap)
 * returns the whole array unchanged.
 */
export function latestSessionSlice(
  history: WallHistorySample[],
  gapSec: number = SESSION_GAP_SEC
): WallHistorySample[] {
  for (let i = history.length - 1; i > 0; i--) {
    if (history[i]!.time - history[i - 1]!.time >= gapSec) return history.slice(i);
  }
  return history;
}

/** Keep a side's strongest `max` levels by |pct|, preserving the recorded (strike) order. */
function slimWallSide(levels: GexWalls["callWalls"], max: number): GexWalls["callWalls"] {
  if (levels.length <= max) return levels;
  const keep = new Set(
    levels
      .map((l, i) => ({ i, m: Math.abs(l.pct) }))
      .sort((a, b) => b.m - a.m)
      .slice(0, max)
      .map((r) => r.i)
  );
  // Filter (not re-sort) so the slimmed ladder keeps the recorded strike order — byte-shape
  // compatible with the full row for every downstream consumer.
  return levels.filter((_, i) => keep.has(i));
}

/**
 * DECIMATE a rail for payload: keep the LAST sample of each `stepSec` bucket. Last-wins (not
 * first-wins) is deliberate — a wall that DIED mid-bucket is still absent from the bucket's last
 * sample, so deaths survive decimation instead of being erased by an earlier sample where the wall
 * still stood. Original sample times + `modeled`/`historical` flags are preserved (times are honest
 * observation times; bucketWallHistoryForInterval re-snaps for display anyway). Optionally slims
 * each kept sample's ladders to the strongest `maxLevelsPerSide` per side — the bead layer only ever
 * draws each bucket's top-3 dominant walls (DOMINANT_WALLS_PER_BUCKET) and the crosshair legend /
 * replay banner read the top few, so a deep 20/side ladder on a PRIOR-day sample is pure payload.
 * Pure; never mutates input.
 */
export function decimateWallHistory(
  samples: WallHistorySample[],
  stepSec: number,
  opts?: { maxLevelsPerSide?: number }
): WallHistorySample[] {
  if (!samples.length) return samples;
  let out: WallHistorySample[];
  if (stepSec > 0) {
    const byBucket = new Map<number, WallHistorySample>();
    for (const s of samples) {
      const key = Math.floor(s.time / stepSec);
      const prev = byBucket.get(key);
      // Last-by-TIME per bucket (not last-by-input-order) so an unsorted input can't flip which
      // sample "wins" — the bucket's final observed state is what survives.
      if (!prev || s.time >= prev.time) byBucket.set(key, s);
    }
    out = [...byBucket.values()].sort((a, b) => a.time - b.time);
  } else {
    out = [...samples];
  }
  const max = opts?.maxLevelsPerSide;
  if (max != null && max > 0) {
    out = out.map((s) => ({
      ...s,
      walls: {
        callWalls: slimWallSide(s.walls.callWalls, max),
        putWalls: slimWallSide(s.walls.putWalls, max),
      },
      vexWalls: s.vexWalls
        ? {
            callWalls: slimWallSide(s.vexWalls.callWalls, max),
            putWalls: slimWallSide(s.vexWalls.putWalls, max),
          }
        : s.vexWalls,
    }));
  }
  return out;
}

/** Tag every sample as belonging to a PRIOR session (historical:true) — see WallHistorySample.
 *  Pure; used to mark the decimated prior-session rail before it's merged with the live latest
 *  session, so the marker layer can dim prior-day clusters. Never mutates input. */
export function markHistorical(samples: WallHistorySample[]): WallHistorySample[] {
  return samples.map((s) => (s.historical ? s : { ...s, historical: true }));
}

export type StrikeTrailPoint = { time: number; pct: number; modeled?: boolean; historical?: boolean };

// MULTI-DAY RAIL BUDGET (GAP A — multi-session bead/wall continuity): one full-resolution latest
// session at the 15s trail cadence (390 min × 4 ≈ 1560) PLUS up to ~14 PRIOR sessions decimated to
// the 2-min prior-session step (~195 samples each ≈ 2730) ≈ 4290 total. 4800 leaves headroom for a
// live day appending on top of a freshly seeded multi-day rail. When the cap trims (recordWallSample
// / mergeWallHistory) it drops the OLDEST samples first — the deepest history day falls off, never
// today's live tail. (Was 1920 = one session + headroom, which silently truncated any multi-session
// seed back down to ~1 day — the reason a multi-session rail could not accumulate.)
const MAX_HISTORY = 4800;

/**
 * Gap length that separates two SESSIONS in a time-keyed multi-day rail. No intraday gap comes
 * close (RTH is 6.5h and the recorder samples every 15s), while the shortest overnight gap
 * (16:00 close → 9:30 next open) is 17.5h — so 8h cleanly splits sessions with huge margin on
 * both sides. Used to (a) scope session-relative reads (wall-integrity "held N% of session") to the
 * LATEST session only via latestSessionSlice, and (b) stop bead REBIRTH cues from firing on the
 * first bucket of a new day (isRebirthGap) — an overnight gap is market closure, not a wall dying
 * and re-forming.
 */
export const SESSION_GAP_SEC = 8 * 60 * 60;

/**
 * Prior-session decimation step for the multi-day seed: sessions OLDER than the latest keep ~1
 * sample per 2 minutes (vs the 15s live cadence), an 8× payload cut that still leaves ~195 beads
 * per prior session — plenty to see walls form/hold/fade at the zoomed-out multi-day replay depth.
 */
export const PRIOR_SESSION_DECIMATION_STEP_SEC = 120;

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
 * near the money, so walls form where price actually is. 3 matches the reference product's default
 * (NODES=3 in the Skylit SPY ref, 2026-07-13): sparse rails where a strike must be among the TOP
 * THREE to earn a bead — which is what makes births/deaths visible even on names whose wider
 * ladder barely rotates (member: TSLA looked static at top-6; the top-3 set genuinely churns).
 * Presence windows + gaps are the product, not noise.
 */
export const DOMINANT_WALLS_PER_BUCKET = 3;

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
      // Carry the sample's modeled + historical flags onto the emitted point so the marker layer can
      // render reconstructed beads dim/ghosted (modeled) and PRIOR-session clusters dimmer/smaller
      // (historical) vs solid current-session observed ones (same bucket time).
      if (last?.time === sample.time) {
        pts[pts.length - 1] = { time: sample.time, pct: level.pct, modeled: sample.modeled, historical: sample.historical };
      } else {
        pts.push({ time: sample.time, pct: level.pct, modeled: sample.modeled, historical: sample.historical });
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
 * Live-session display split for a MULTI-DAY rail (GAP A). PRIOR sessions are always drawn IN FULL
 * — they are frozen historical clusters, the whole point of "today's chart should show yesterday's
 * beads" — while only the LATEST session is trimmed to the live lookback window so migrated strikes
 * don't leave stale full-width bead rows across today. Splits at the last session-sized gap
 * (SESSION_GAP_SEC): a single-session rail (no gap) degrades to the plain live trim, so nothing
 * changes for a name with no prior-day history. Concatenation stays globally time-ascending because
 * the prior slice ends before the (later) latest session's trimmed window.
 */
export function trailHistoryForLiveDisplay(
  history: WallHistorySample[],
  lookbackSec: number = LIVE_TRAIL_LOOKBACK_SEC,
  anchorSec?: number,
  gapSec: number = SESSION_GAP_SEC
): WallHistorySample[] {
  if (!history.length) return history;
  const latest = latestSessionSlice(history, gapSec);
  const trimmedLatest = trimHistoryForLiveTrails(latest, lookbackSec, anchorSec);
  if (latest.length === history.length) return trimmedLatest; // single session — unchanged behaviour
  const prior = history.slice(0, history.length - latest.length);
  return prior.concat(trimmedLatest);
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
/**
 * UNIVERSE PARITY (any-ticker rail): fill the PRE-VIEW gap of a session with the honest
 * reconstruction, without ever touching observed samples.
 *
 * A ticker outside the pre-recorded universe has no rail before its first viewer connects — the
 * live hub records from first view onward, so a member opening (say) PLTR at 2pm sees a rail that
 * starts at 2pm. This helper backfills ONLY the missing PREFIX (buckets strictly BEFORE the first
 * observed sample) from the reconstruction rail (fixed published OI, gamma recomputed along the
 * session's real spot path — genuinely time-varying, labeled modeled → ghost beads). Observed
 * samples stay solid and untouched; the model never overwrites or extends past them, so a member
 * can always tell recorded structure from reconstructed context.
 *
 * No-ops (returns `observed` as-is) when the observed rail already starts near the session open
 * (prefix gap ≤ minPrefixGapSec) or the model has nothing before the first observed bucket.
 */
export function backfillRailPrefix(
  observed: WallHistorySample[],
  modeled: WallHistorySample[],
  firstBarTime: number | undefined,
  minPrefixGapSec: number = 20 * 60
): WallHistorySample[] {
  if (!modeled?.length || firstBarTime == null || !Number.isFinite(firstBarTime)) return observed;
  // First observed sample IN the latest session (at/after its first bar). In a MULTI-DAY rail
  // `observed` leads with PRIOR-day samples, whose times are far below firstBarTime and say nothing
  // about the latest session's morning gap — so anchor on the first sample at/after firstBarTime,
  // not observed[0]. For a single-session rail this is exactly observed[0] (unchanged behaviour).
  const firstObserved = observed.find((s) => s.time >= firstBarTime)?.time ?? Number.POSITIVE_INFINITY;
  if (firstObserved - firstBarTime <= minPrefixGapSec) return observed;
  const prefix = modeled.filter((s) => s.time < firstObserved);
  if (!prefix.length) return observed;
  return mergeModeledUnderlay(observed, prefix);
}

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
