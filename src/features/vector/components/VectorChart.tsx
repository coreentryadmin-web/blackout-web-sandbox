"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  LineStyle,
  type AutoscaleInfo,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { VectorCrosshairLegend, type VectorCrosshairState } from "@/features/vector/components/VectorCrosshairLegend";
import { VectorToolbar } from "@/features/vector/components/VectorToolbar";
import {
  createVectorEventSource,
  type VectorDarkPoolLevel,
  type VectorWallLevel,
  type VectorWalls,
} from "@/lib/api";
import {
  appendVectorWallEvents,
  detectSpotStructureEvents,
  diffVectorWallSample,
  eventsFromWallHistory,
  type VectorWallEvent,
} from "@/features/vector/lib/vector-wall-events";
import { VECTOR_CHART_LOCALE } from "@/features/vector/lib/vector-chart-config";
import {
  normalizeDteHorizon,
  pickHorizonScopedValue,
  type VectorDteHorizon,
} from "@/features/vector/lib/vector-dte-horizon";
import { deriveVectorRegime, type VectorRegime } from "@/features/vector/lib/vector-regime";
import { deriveWallProximity, type WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import { deriveGammaMagnet, type GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import {
  extendRangeForWalls,
  DEFAULT_WALL_VIEW_MAX_PCT,
  BEAD_VIEW_MAX_PCT,
} from "@/features/vector/lib/vector-price-range";
import { scoreTopWalls, type WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";
import {
  alphaForPct,
  alphaForPctRel,
  glowAlphaForPctRel,
  markerSizeForPctRel,
  widthForPct,
  MODELED_ALPHA_SCALE,
} from "@/features/vector/lib/vector-wall-visual";
import {
  bucketWallHistoryForInterval,
  composeHorizonTrail,
  hasVexInHistory,
  liveTrailAnchorSec,
  mergeWallHistory,
  narrowedHorizonTrail,
  pickActiveStrikes,
  pickReplayTrailSource,
  trailsByStrike,
  trimHistoryForLiveTrails,
  type StrikeTrailPoint,
  type VectorWallLens,
  type WallHistorySample,
} from "@/features/vector/lib/vector-wall-history";
import { pickKingStrikes, kingAnchorTitle } from "@/features/vector/lib/vector-king-anchor";
import { smaSeries, emaSeries, vwapSeries } from "@/features/vector/lib/vector-indicators";
import {
  VECTOR_OVERLAYS,
  VECTOR_LEVELS,
  type VectorOverlayId,
  type VectorIndicatorId,
} from "@/features/vector/lib/vector-indicators-config";
import { levelLinesFor, type LevelLine, type PriorDayOhlc } from "@/features/vector/lib/vector-key-levels";
import {
  buildReplayTimeline,
  clampTimelineIndex,
  flipAtCrosshairTime,
  flipAtReplayTime,
  flipForActiveLens,
  formatReplayClock,
  sliceBarsToTime,
  sliceHistoryToTime,
  timelineIndexAtOrAfterEtClock,
  timelineIndexAtOrBeforeEtClock,
  wallsAtCrosshairTime,
  wallsAtReplayTime,
  wallsForActiveLens,
} from "@/features/vector/lib/vector-replay";
import {
  aggregateVectorBars,
  mergeBarsByTime,
  wallCountForTimeframe,
  VECTOR_WALL_NODES_PER_SIDE,
  type VectorTimeframeMinutes,
} from "@/features/vector/lib/vector-bar-timeframes";
import { mergeSpyVolumeRows } from "@/features/vector/lib/vector-spy-volume-merge";

export type VectorBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  /** SPY 1m share volume proxy aligned to this SPX bar. */
  volume?: number;
};

// Put beads are brightened from #b26bff so purple reads as strongly as the gold call beads at the
// SAME opacity. Yellow (#ffd60a, ~0.72 rel-luminance) punches through a dark chart at low alpha;
// the old purple (~0.30) washed out — so at the dimmed modeled-underlay alpha (0.15) members saw
// "only yellow beads." #d97bff (~0.52) closes that perceptual gap so both colors ghost/solidify
// together at every alpha, off-hours and in live RTH alike.
const PUT_WALL_COLOR = "#d97bff";
const CALL_WALL_COLOR = "#ffd60a";
const VEX_POS_COLOR = "#7dd3fc";
const VEX_NEG_COLOR = "#fb7185";
const GAMMA_FLIP_COLOR = "#22d3ee";
const VANNA_FLIP_COLOR = "#38bdf8";
const DARK_POOL_COLOR = "#ff8a3d"; // orange, not cyan — dark-pool cyan #00d4ff failed CVD separation vs gamma-flip cyan #22d3ee (worst-pair ΔE 6.9); orange lifts it to 36.7 (validated via dataviz palette checker)
const REPLAY_STEP_MS = 350;
/** Widen the price axis to reveal walls within this % of spot (env-tunable). Without
 *  this the axis fits candles only and support walls a few % below spot render off-screen. */
const WALL_VIEW_MAX_PCT = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_VECTOR_WALL_VIEW_MAX_PCT);
  return Number.isFinite(raw) && raw > 0 && raw <= 0.2 ? raw : DEFAULT_WALL_VIEW_MAX_PCT;
})();
const MAX_DP_GUIDES = 6;
/** Empty walls used to CLEAR the wall guide price-lines each refresh — walls now render only as
 *  strength-scaled beads (Skylit-clean axis), so the full-width "Call/Put wall — %" guide lines
 *  are gone; the axis carries just the current price + the gamma-flip line. */
const EMPTY_WALLS: VectorWalls = { callWalls: [], putWalls: [] };
/** Trailing whitespace (in bars) between the last candle and the price axis — so the bead bands
 *  stop short of the axis with breathing room instead of running flush into it (Skylit-style). */
const VECTOR_RIGHT_OFFSET_BARS = 6;
/** Re-poll cadence for the SPY volume backfill — Polygon only publishes one new closed
 *  minute bar per minute, so anything faster than that would just refetch the same data. */
const SPY_VOLUME_BACKFILL_MS = 60_000;
/** If the viewport is within this many bars of the live edge, new bars may follow (TradingView-style). */
const LIVE_FOLLOW_THRESHOLD_BARS = 2;

function chartIsFollowingLive(chart: IChartApi): boolean {
  const pos = chart.timeScale().scrollPosition();
  return Number.isFinite(pos) && pos <= LIVE_FOLLOW_THRESHOLD_BARS;
}

/** Avoid yanking pan/zoom when the member scrolled back to study structure. */
function maybeScrollToLive(chart: IChartApi | null): void {
  if (!chart || !chartIsFollowingLive(chart)) return;
  chart.timeScale().scrollToRealTime();
}

type Props = {
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
  onFreshness?: (updatedAt: number) => void;
  onWallEventsChange?: (events: VectorWallEvent[]) => void;
  onLensChange?: (lens: VectorWallLens) => void;
  onRegimeChange?: (regime: VectorRegime) => void;
  onProximityChange?: (proximity: WallProximity | null) => void;
  onMagnetChange?: (magnet: GammaMagnet | null) => void;
  onWallIntegrityChange?: (integrity: { call: WallIntegrity | null; put: WallIntegrity | null }) => void;
};

function lensVisuals(lens: VectorWallLens) {
  return lens === "vex"
    ? {
        callColor: VEX_POS_COLOR,
        putColor: VEX_NEG_COLOR,
        flipColor: VANNA_FLIP_COLOR,
        callLabel: "Vanna +",
        putLabel: "Vanna −",
        flipLabel: "Vanna flip",
      }
    : {
        callColor: CALL_WALL_COLOR,
        putColor: PUT_WALL_COLOR,
        flipColor: GAMMA_FLIP_COLOR,
        callLabel: "Call wall",
        putLabel: "Put wall",
        flipLabel: "Gamma flip",
      };
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pinCandlesOnTop(candleSeries: ISeriesApi<"Candlestick">): void {
  const count = candleSeries.getPane().getSeries().length;
  if (count > 0) candleSeries.setSeriesOrder(count - 1);
}

const VOLUME_UP = "rgba(0, 230, 118, 0.72)";
const VOLUME_DOWN = "rgba(255, 45, 85, 0.72)";

function volumeHistogramData(bars: VectorBar[]): HistogramData<Time>[] {
  const out: HistogramData<Time>[] = [];
  for (const bar of bars) {
    const value = bar.volume;
    if (value == null || value <= 0) continue;
    out.push({
      time: bar.time as Time,
      value,
      color: bar.close >= bar.open ? VOLUME_UP : VOLUME_DOWN,
    });
  }
  return out;
}

function applyDisplayBars(
  candleSeries: ISeriesApi<"Candlestick">,
  volumeSeries: ISeriesApi<"Histogram"> | null,
  bars: VectorBar[]
): void {
  candleSeries.setData(bars);
  volumeSeries?.setData(volumeHistogramData(bars));
}

function applyPriceGuides(
  series: ISeriesApi<"Candlestick">,
  guideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: Array<{ strike: number; pct: number; label: string }>,
  baseColor: string,
  maxGuides: number,
  axisOnly = false
): void {
  for (let i = 0; i < maxGuides; i++) {
    const level = levels[i];
    const lineRef = guideRefs.current[i];
    if (!level) {
      if (lineRef) {
        series.removePriceLine(lineRef);
        guideRefs.current[i] = null;
      }
      continue;
    }
    const title = `${level.label} ${Math.round(level.strike)} — ${level.pct.toFixed(0)}%`;
    const color = withAlpha(baseColor, axisOnly ? 0.9 : alphaForPct(level.pct) * 0.35);
    const lineWidth = axisOnly ? 1 : widthForPct(level.pct);
    if (guideRefs.current[i]) {
      guideRefs.current[i]!.applyOptions({
        price: level.strike,
        title,
        color,
        lineWidth,
        lineStyle: LineStyle.Dashed,
        lineVisible: !axisOnly,
        axisLabelVisible: true,
      });
    } else {
      guideRefs.current[i] = series.createPriceLine({
        price: level.strike,
        color,
        lineWidth,
        lineStyle: LineStyle.Dashed,
        lineVisible: !axisOnly,
        axisLabelVisible: true,
        title,
      });
    }
  }
}

function applyWallGuides(
  series: ISeriesApi<"Candlestick">,
  guideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: VectorWallLevel[],
  baseColor: string,
  label: string,
  maxGuides: number
): void {
  // Grow the guide-ref array to the server cap so a higher timeframe has slots to draw into —
  // same grow-then-fill pattern as applyDarkPoolGuides (the wall count is now variable per
  // timeframe, not a fixed 6). We size to VECTOR_WALL_NODES_PER_SIDE (the max any timeframe can
  // ask for) rather than maxGuides so the array never has to shrink.
  if (guideRefs.current.length < VECTOR_WALL_NODES_PER_SIDE) {
    guideRefs.current = [
      ...guideRefs.current,
      ...Array.from({ length: VECTOR_WALL_NODES_PER_SIDE - guideRefs.current.length }, () => null),
    ];
  }
  // Walk the FULL ref array (guideRefs.current.length), not just maxGuides: on a DOWNSHIFT
  // (e.g. 15m→1m) maxGuides drops from 12 to 6, so slots 6..11 hold price lines that must be
  // removed. levels is sliced to maxGuides, so applyPriceGuides sees `undefined` for every
  // slot past the new count and clears it (removePriceLine + null) — no stale guides linger.
  applyPriceGuides(
    series,
    guideRefs,
    levels.slice(0, maxGuides).map((l) => ({ ...l, label })),
    baseColor,
    guideRefs.current.length,
    true
  );
}

function applyDarkPoolGuides(
  series: ISeriesApi<"Candlestick">,
  guideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: VectorDarkPoolLevel[]
): void {
  if (guideRefs.current.length < MAX_DP_GUIDES) {
    guideRefs.current = [
      ...guideRefs.current,
      ...Array.from({ length: MAX_DP_GUIDES - guideRefs.current.length }, () => null),
    ];
  }
  applyPriceGuides(
    series,
    guideRefs,
    levels.slice(0, MAX_DP_GUIDES).map((l) => ({ strike: l.strike, pct: l.pct, label: "DP" })),
    DARK_POOL_COLOR,
    MAX_DP_GUIDES,
    true
  );
}

function applyFlipGuide(
  series: ISeriesApi<"Candlestick">,
  lineRef: React.MutableRefObject<IPriceLine | null>,
  flip: number | null | undefined,
  label: string,
  color: string
): void {
  if (flip == null || !Number.isFinite(flip) || flip <= 0) {
    if (lineRef.current) {
      series.removePriceLine(lineRef.current);
      lineRef.current = null;
    }
    return;
  }
  const title = `${label} ${Math.round(flip)}`;
  const lineColor = withAlpha(color, 0.9);
  // The gamma flip is now the ONE analytical line on the chart (walls became beads, dark-pool
  // lines removed), so draw it as a real dashed line — not just an axis label — the single
  // regime-boundary reference the member kept.
  if (lineRef.current) {
    lineRef.current.applyOptions({
      price: flip,
      title,
      color: lineColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: true,
      axisLabelVisible: true,
    });
  } else {
    lineRef.current = series.createPriceLine({
      price: flip,
      color: lineColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: true,
      axisLabelVisible: true,
      title,
    });
  }
}

/**
 * King anchor — a persistent SOLID line at the single dominant call/put wall (member ask: "mark
 * the King node / anchor on the chart"). Distinct from the walls-as-beads treatment (#173) and the
 * dashed flip line: only the two strongest strikes get a line, styled as an anchor (solid, brighter,
 * ⚓ title), so a member always has the key level to trade against. The strike is chosen by
 * pickKingStrikes from the HORIZON-SCOPED walls, so the anchor re-scopes with the DTE toggle and is
 * redrawn every refreshOverlays (live + replay). Null strike → the line is removed.
 */
function applyKingAnchor(
  series: ISeriesApi<"Candlestick">,
  lineRef: React.MutableRefObject<IPriceLine | null>,
  strike: number | null,
  color: string
): void {
  if (strike == null || !Number.isFinite(strike) || strike <= 0) {
    if (lineRef.current) {
      series.removePriceLine(lineRef.current);
      lineRef.current = null;
    }
    return;
  }
  const title = kingAnchorTitle(strike);
  const lineColor = withAlpha(color, 0.85);
  if (lineRef.current) {
    lineRef.current.applyOptions({
      price: strike,
      title,
      color: lineColor,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      lineVisible: true,
      axisLabelVisible: true,
    });
  } else {
    lineRef.current = series.createPriceLine({
      price: strike,
      color: lineColor,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      lineVisible: true,
      axisLabelVisible: true,
      title,
    });
  }
}

const LEVEL_LINE_STYLE = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
} as const;

/**
 * Draw/diff the enabled "Key levels" price lines (HOD/LOD, opening range, fib) on the candle series.
 * Each enabled level id expands to one or more {@link LevelLine}s via `levelLinesFor(bars)`; the map
 * (keyed `levelId:lineKey`) is reconciled against the desired set so lines are added/updated/removed
 * without churn. Computed from the CURRENTLY-shown bars, so levels track the timeframe and, in
 * replay, reflect the bars up to the cursor (HOD/LOD-so-far). Nothing drawn when the set is empty.
 */
function applyLevelLines(
  series: ISeriesApi<"Candlestick">,
  map: Map<string, IPriceLine>,
  enabled: Set<VectorIndicatorId>,
  bars: VectorBar[],
  priorDay: PriorDayOhlc | null
): void {
  const desired = new Map<string, LevelLine>();
  for (const def of VECTOR_LEVELS) {
    if (!enabled.has(def.id)) continue;
    for (const line of levelLinesFor(def.id, bars, priorDay))
      desired.set(`${def.id}:${line.key}`, line);
  }
  // Remove lines no longer wanted (toggled off, or a level that now yields fewer lines).
  for (const [k, pl] of map) {
    if (!desired.has(k)) {
      series.removePriceLine(pl);
      map.delete(k);
    }
  }
  for (const [k, line] of desired) {
    const opts = {
      price: line.price,
      color: withAlpha(line.color, 0.9),
      lineWidth: 1 as const,
      lineStyle: LEVEL_LINE_STYLE[line.style],
      lineVisible: true,
      axisLabelVisible: true,
      title: line.label,
    };
    const existing = map.get(k);
    if (existing) existing.applyOptions(opts);
    else map.set(k, series.createPriceLine(opts));
  }
}

function applyWallsToSeries(
  series: ISeriesApi<"Candlestick">,
  callGuideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  putGuideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  walls: VectorWalls | null | undefined,
  lens: VectorWallLens,
  maxGuides: number
): void {
  // Must still call through (with empty levels) rather than early-return on null —
  // applyWallGuides/applyPriceGuides clear stale price lines when passed [], but an
  // early return here skips that entirely, leaving whatever was drawn on the PREVIOUS
  // frame's walls stuck on the chart. That silently masked the replay pre-first-sample
  // fix below: nulling out gexAt/vexAt during early-timeline scrubbing did nothing
  // visually because the old wall lines never got cleared.
  const v = lensVisuals(lens);
  applyWallGuides(series, callGuideRefs, walls?.callWalls ?? [], v.callColor, v.callLabel, maxGuides);
  applyWallGuides(series, putGuideRefs, walls?.putWalls ?? [], v.putColor, v.putLabel, maxGuides);
}

function buildWallBeadMarkers(
  trails: Map<number, StrikeTrailPoint[]>,
  activeStrikes: number[],
  baseColor: string
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  // Frame-relative strength: find the STRONGEST wall currently in view, and scale every bead's
  // thickness/opacity against it (markerSizeForPctRel), NOT against a fixed 7% saturation. Per-
  // strike gamma share is ~6-8% on the UW oracle ladder but 20-40% on the per-expiry chain path,
  // so the old absolute cap clipped every stock wall to max → all beads looked identically fat
  // ("all our beads feel the same"). Normalizing to the in-frame king restores the Skylit fat-
  // king / thin-straggler contrast at any concentration, and — because a strike's pct varies
  // over the session — also makes a wall's band bulge thicker in the stretch where it built up.
  let maxPct = 0;
  for (const strike of activeStrikes) {
    const points = trails.get(strike);
    if (!points) continue;
    for (const p of points) if (p.pct > maxPct) maxPct = p.pct;
  }
  for (const strike of activeStrikes) {
    const points = trails.get(strike);
    if (!points) continue;
    for (const p of points) {
      const time = p.time as Time;
      // Modeled (reconstructed) beads read as a FAINT, smaller GHOST of an observed bead: same
      // color/shape, alpha scaled to MODELED_ALPHA_SCALE (0.15) and size to 0.6×, so a real recorded
      // sample (solid, full size) is unmistakably "more real" wherever it overwrites the modeled one
      // — and a full-width reconstruction reads as a quiet underlay, not axis-to-axis walls.
      // Observed beads (modeled falsy) are unchanged.
      const modeled = p.modeled === true;
      const alphaScale = modeled ? MODELED_ALPHA_SCALE : 1;
      const size = markerSizeForPctRel(p.pct, maxPct) * (modeled ? 0.6 : 1);
      const coreAlpha = alphaForPctRel(p.pct, maxPct) * alphaScale;
      const glowAlpha = glowAlphaForPctRel(p.pct, maxPct) * alphaScale;
      // Halo + core — Skylit-style glow on dominant walls (per-bead size + opacity).
      markers.push({
        time,
        position: "atPriceMiddle",
        price: strike,
        shape: "circle",
        color: withAlpha(baseColor, glowAlpha),
        size: size * 2.2,
      });
      markers.push({
        time,
        position: "atPriceMiddle",
        price: strike,
        shape: "circle",
        color: withAlpha(baseColor, coreAlpha),
        size,
      });
    }
  }
  return markers;
}

function applyWallBeadMarkers(
  beadsPlugin: ISeriesMarkersPluginApi<Time> | null,
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  baseColor: string,
  lens: VectorWallLens,
  intervalMinutes: VectorTimeframeMinutes
): number[] {
  if (!beadsPlugin) return [];
  const bucketed = bucketWallHistoryForInterval(history, intervalMinutes);
  const trails = trailsByStrike(bucketed, side, lens);
  // Bead strike-rows scale with the timeframe the same way the wall guides do — few near-spot
  // rows on 1m, more (further-out) rows on higher timeframes.
  const active = pickActiveStrikes(trails, wallCountForTimeframe(intervalMinutes));
  beadsPlugin.setMarkers(buildWallBeadMarkers(trails, active, baseColor));
  // Return the strikes actually drawn so the caller can widen the price axis to cover them —
  // otherwise a drawn bead outside the current-ladder range clips out on zoom (see beadStrikesRef).
  return active;
}

function upsertBar(bars: VectorBar[], candle: VectorBar): VectorBar[] {
  const last = bars[bars.length - 1];
  if (last && last.time === candle.time) {
    return [...bars.slice(0, -1), candle];
  }
  if (!last || candle.time > last.time) {
    return [...bars, candle];
  }
  return bars;
}

function emptyGuideRefs(): (IPriceLine | null)[] {
  // Sized to the server cap (max any timeframe can draw); applyWallGuides only fills up to the
  // timeframe's scaled count and clears the rest.
  return Array.from({ length: VECTOR_WALL_NODES_PER_SIDE }, () => null);
}

function displayBarsFromMinute(
  minuteBars: VectorBar[],
  intervalMinutes: VectorTimeframeMinutes,
  cursorTime?: number
): VectorBar[] {
  const base =
    cursorTime != null ? (sliceBarsToTime(minuteBars, cursorTime) as VectorBar[]) : minuteBars;
  return aggregateVectorBars(base, intervalMinutes) as VectorBar[];
}

export function VectorChart({
  ticker,
  initialBars,
  initialWalls,
  initialVexWalls,
  initialWallHistory,
  initialGammaFlip,
  initialVexFlip,
  initialDarkPoolLevels,
  sessionYmd,
  liveSession,
  onFreshness,
  onWallEventsChange,
  onRegimeChange,
  onProximityChange,
  onMagnetChange,
  onWallIntegrityChange,
  onLensChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const callGuideRefs = useRef<(IPriceLine | null)[]>(emptyGuideRefs());
  const putGuideRefs = useRef<(IPriceLine | null)[]>(emptyGuideRefs());
  // Strikes currently drawn on the chart — read by the candle series'
  // autoscaleInfoProvider to widen the price axis so support/resistance walls
  // (esp. put walls a few % below spot) aren't clipped off-screen. Seeded from the
  // SSR walls so the FIRST autoscale on mount already includes them.
  // Sliced to the 1m shown-count (the mount default timeframe) so the first autoscale matches
  // what's actually drawn; refreshOverlays re-slices to the active timeframe on every repaint.
  const rangeWallsRef = useRef<{ call: number[]; put: number[] }>({
    call: (initialWalls?.callWalls ?? []).slice(0, wallCountForTimeframe(1)).map((w) => w.strike),
    put: (initialWalls?.putWalls ?? []).slice(0, wallCountForTimeframe(1)).map((w) => w.strike),
  });
  // The strikes ACTUALLY drawn as beads (from the session-trail rail, per side). The autoscale
  // provider widens for these too — not just the live ladder in rangeWallsRef — so a bead never
  // clips out when zoom re-runs autoscale off fewer visible candles. Populated by refreshTrails.
  const beadStrikesRef = useRef<{ call: number[]; put: number[] }>({ call: [], put: [] });
  const dpGuideRefs = useRef<(IPriceLine | null)[]>([]);
  const flipGuideRef = useRef<IPriceLine | null>(null);
  // King anchors — solid lines at the single dominant call/put wall (member ask). Re-scope with the
  // DTE horizon (they read the same horizon-scoped walls refreshOverlays draws) and are cleared on
  // ticker switch / unmount alongside the flip line.
  const kingCallLineRef = useRef<IPriceLine | null>(null);
  const kingPutLineRef = useRef<IPriceLine | null>(null);
  // Opt-in technical overlays (VWAP/EMA/SMA) — one lightweight-charts line series per enabled
  // indicator, created on demand and removed when toggled off. Default: none. `indicatorsRef`
  // mirrors the state for the imperative paint path; `lastDisplayBarsRef` lets a toggle repaint
  // against the currently-shown bars without waiting for the next tick/timeframe change.
  const overlaySeriesRef = useRef<Map<VectorOverlayId, ISeriesApi<"Line">>>(new Map());
  // Horizontal price-line overlays for the "Key levels" group (HOD/LOD, opening range, fib), keyed
  // by `${levelId}:${lineKey}` so each line is diffed/kept/removed independently across repaints.
  const levelLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  // Prior-session OHLC for the PDH/PDL/PDC + floor-pivot levels — fetched once per ticker (only when
  // such a level is enabled). `priorDayTickerRef` guards a fetch from a previous ticker landing late.
  const priorDayRef = useRef<PriorDayOhlc | null>(null);
  const priorDayTickerRef = useRef<string | null>(null);
  const indicatorsRef = useRef<Set<VectorIndicatorId>>(new Set());
  const lastDisplayBarsRef = useRef<VectorBar[]>(initialBars);
  const callBeadsRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const putBeadsRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const wallHistoryRef = useRef<WallHistorySample[]>(initialWallHistory);
  /** Canonical 1m session bars — SSE live ticks and Polygon seed write here only. */
  const minuteBarsRef = useRef<VectorBar[]>(initialBars);
  const displayBarTimeRef = useRef<number>(0);
  const timeframeRef = useRef<VectorTimeframeMinutes>(1);
  const gammaFlipRef = useRef<number | null>(initialGammaFlip);
  const vexFlipRef = useRef<number | null>(initialVexFlip);
  const darkPoolRef = useRef<VectorDarkPoolLevel[]>(initialDarkPoolLevels);
  const gexWallsRef = useRef<VectorWalls | null>(initialWalls);
  const vexWallsRef = useRef<VectorWalls | null>(initialVexWalls);
  // DTE-horizon override: when the member picks a horizon other than "all", the
  // displayed GEX walls come from an on-demand fetch of /api/market/vector/walls
  // (the per-second SSE stream keeps carrying the full near-term walls into
  // gexWallsRef untouched). null = follow the live stream. See liveGexWalls().
  const horizonWallsRef = useRef<VectorWalls | null>(null);
  // Horizon-scoped gamma flip, paired with horizonWallsRef: when a narrower DTE is
  // active the flip line re-scopes to the same per-expiry ladder the walls came from
  // (server returns it on /api/market/vector/walls). null = follow the live stream flip.
  const horizonFlipRef = useRef<number | null>(null);
  // Recorded per-horizon bead trail (the FROZEN point-in-time clusters for the active narrowed
  // horizon), fetched from /api/market/vector/wall-history on each DTE toggle. Empty for "all"
  // (that rail is SSR-seeded into wallHistoryRef) or when nothing was recorded for the horizon.
  // refreshTrails prefers this over the single-column narrowedHorizonTrail so weekly/monthly show
  // the accumulated clusters after close — the after-hours analogue of the live "All" rail.
  const horizonHistoryRef = useRef<WallHistorySample[]>([]);
  const dteHorizonRef = useRef<VectorDteHorizon>("all");
  // Dedupe regime emissions — the read only changes when posture/flip/levels
  // shift, not every tick, so we skip identical reads to avoid re-rendering the
  // banner on every SSE frame.
  const lastRegimeReadRef = useRef<string>("");
  const lastProximityRef = useRef<string>("");
  const lastMagnetRef = useRef<string>("");
  const lastWallIntegrityRef = useRef<string>("");
  const lensRef = useRef<VectorWallLens>("gex");
  const spotRef = useRef<number | null>(
    initialBars.length ? initialBars[initialBars.length - 1]!.close : null
  );
  const timelineRef = useRef<number[]>([]);
  const connRef = useRef<ReturnType<typeof createVectorEventSource> | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayModeRef = useRef(false);
  const liveSessionRef = useRef(liveSession);
  /**
   * Mirrors cursorIndex for reads outside React's render cycle (replay timer, lens
   * repaint, stepReplay). Keeping paints OUT of setCursorIndex updater callbacks matters:
   * updaters must be pure (StrictMode double-invokes them), so applyFrame calls live next
   * to the state set instead of inside it.
   */
  const cursorIndexRef = useRef(0);

  const [sessionHistory, setSessionHistory] = useState(initialWallHistory);
  const [sessionBars, setSessionBars] = useState(initialBars);
  const [replayMode, setReplayMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayLoop, setReplayLoop] = useState(false);
  const [crosshair, setCrosshair] = useState<VectorCrosshairState | null>(null);
  const [lens, setLens] = useState<VectorWallLens>("gex");
  const [dteHorizon, setDteHorizon] = useState<VectorDteHorizon>("all");
  // Per-expiry walls are now computed from the Polygon options chain for EVERY ticker
  // (per-contract expiry + OI + IV → BSM GEX ladder at spot), not just the 3 UW-oracle
  // names, so the horizon toggle is real everywhere. Vector only ever loads optionable
  // tickers, and getVectorGexWallsForHorizon's honest fallback guarantees walls never
  // blank, so the toggle is always available.
  const dteAvailable = true;
  // appendVectorWallEvents enforces the display cap — a bare concat of both
  // lenses' seeds could hold up to 2× the cap.
  const [wallEvents, setWallEvents] = useState<VectorWallEvent[]>(() =>
    appendVectorWallEvents(eventsFromWallHistory(initialWallHistory, "gex"), [
      ...eventsFromWallHistory(initialWallHistory, "vex"),
    ])
  );
  const [vexAvailable, setVexAvailable] = useState(
    () =>
      Boolean(initialVexWalls?.callWalls?.length || initialVexWalls?.putWalls?.length) ||
      hasVexInHistory(initialWallHistory)
  );
  const [gexAsOf, setGexAsOf] = useState<number | null>(null);
  const [vexAsOf, setVexAsOf] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<VectorTimeframeMinutes>(1);
  const [chartReady, setChartReady] = useState(false);
  // Enabled overlay indicators (default none — the chart stays clean until the member opts in).
  const [indicators, setIndicators] = useState<Set<VectorIndicatorId>>(() => new Set());

  useEffect(() => {
    // Replay honesty for the structure feed: while scrubbed to 9:35 the ticker
    // must not display events that happened at 11:00 — filter to the cursor.
    // Events keep accumulating in state (the SSE stays open in replay); only
    // what consumers SEE is cursor-gated. cursorIndex is a dep so the feed
    // advances as the member scrubs/plays.
    if (replayMode) {
      const cursor = timelineRef.current[cursorIndex] ?? 0;
      onWallEventsChange?.(wallEvents.filter((e) => e.time <= cursor));
      return;
    }
    onWallEventsChange?.(wallEvents);
  }, [wallEvents, onWallEventsChange, replayMode, cursorIndex]);

  useEffect(() => {
    onLensChange?.(lens);
  }, [lens, onLensChange]);

  useEffect(() => {
    setWallEvents(
      appendVectorWallEvents(eventsFromWallHistory(initialWallHistory, "gex"), [
        ...eventsFromWallHistory(initialWallHistory, "vex"),
      ])
    );
  }, [ticker, initialWallHistory]);

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  useEffect(() => {
    lensRef.current = lens;
  }, [lens]);

  useEffect(() => {
    liveSessionRef.current = liveSession;
  }, [liveSession]);

  useEffect(() => {
    replayModeRef.current = replayMode;
  }, [replayMode]);

  useEffect(() => {
    cursorIndexRef.current = cursorIndex;
  }, [cursorIndex]);

  const refreshTrails = useCallback((activeLens: VectorWallLens) => {
    const series = seriesRef.current;
    if (!series) return;
    const v = lensVisuals(activeLens);
    // NARROWED DTE HORIZON (0DTE/weekly/monthly) — two sources, in precedence order:
    //   1. horizonHistoryRef: the RECORDED per-horizon trail (composite-keyed rail, PR #186),
    //      fetched by the DTE effect. This is the full point-in-time cluster history for the
    //      horizon — the after-close analogue of the blended "All" rail — so weekly/monthly show
    //      accumulated frozen clusters, not a single column (member ask). Merged with (2) so the
    //      newest live structure paints even before the 5-min recorder writes the current bucket.
    //   2. narrowedHorizonTrail: the CURRENT horizon-scoped walls (fetched into horizonWallsRef by
    //      the DTE effect, refreshed each 15s in RTH) as ONE column at the latest bar — the honest
    //      "current 0DTE/weekly/monthly structure", used alone before any history is recorded.
    // Both are null/empty for All / VEX / empty-scope, in which case we draw the blended rail as
    // before (member finding "select 0DTE, still shows All's walls" is still fixed either way).
    const lastBarTime = minuteBarsRef.current[minuteBarsRef.current.length - 1]?.time ?? 0;
    const horizon = dteHorizonRef.current;
    const currentColumn = narrowedHorizonTrail(
      horizon,
      activeLens,
      horizonWallsRef.current,
      lastBarTime,
      horizonFlipRef.current
    );
    // Gate the recorded trail on horizon+lens here; composeHorizonTrail owns the merge precedence.
    const recordedTrail =
      horizon !== "all" && activeLens === "gex" ? horizonHistoryRef.current : null;
    const history: WallHistorySample[] =
      composeHorizonTrail(recordedTrail, currentColumn) ??
      (liveSessionRef.current && !replayModeRef.current
        ? trimHistoryForLiveTrails(
            wallHistoryRef.current,
            undefined,
            liveTrailAnchorSec(wallHistoryRef.current, minuteBarsRef.current.map((b) => b.time))
          )
        : wallHistoryRef.current);
    const callStrikes = applyWallBeadMarkers(callBeadsRef.current, history, "callWalls", v.callColor, activeLens, timeframeRef.current);
    const putStrikes = applyWallBeadMarkers(putBeadsRef.current, history, "putWalls", v.putColor, activeLens, timeframeRef.current);
    // Record what was actually drawn so the autoscale provider widens to reveal these exact beads
    // at every zoom level, then nudge a rescale (off-hours there is no tick to trigger it).
    beadStrikesRef.current = { call: callStrikes, put: putStrikes };
    series.priceScale().applyOptions({ autoScale: true });
    pinCandlesOnTop(series);
  }, []);

  const refreshOverlays = useCallback(
    (
      activeLens: VectorWallLens,
      gexWalls: VectorWalls | null,
      vexWalls: VectorWalls | null,
      gammaFlip: number | null,
      vexFlip: number | null,
      dp: VectorDarkPoolLevel[]
    ) => {
      const series = seriesRef.current;
      if (!series) return;
      const walls = wallsForActiveLens(activeLens, gexWalls, vexWalls);
      const flip = flipForActiveLens(activeLens, gammaFlip, vexFlip);
      const v = lensVisuals(activeLens);
      // How many wall guides/beads THIS timeframe shows (1m→6 … 15m→12). Higher timeframe →
      // more, further-out walls drawn → wider axis (extendRangeForWalls keys off these SHOWN
      // strikes below, so 1m stays tight while 15m widens).
      const maxGuides = wallCountForTimeframe(timeframeRef.current);
      // Walls are shown ONLY as strength-scaled beads now (the Skylit-clean look) — clear any
      // wall guide price-lines rather than drawing them, so the price axis is not stacked with
      // "Call/Put wall — %" labels. The gamma-flip line stays (member kept it); dark-pool level
      // lines are removed from the axis too. rangeWallsRef below still keys off the walls, so the
      // axis keeps auto-widening to reveal the bead rows.
      applyWallsToSeries(series, callGuideRefs, putGuideRefs, EMPTY_WALLS, activeLens, 0);
      applyFlipGuide(series, flipGuideRef, flip, v.flipLabel, v.flipColor);
      // King anchors: solid lines at the dominant call/put wall of the ACTIVE (horizon-scoped) walls,
      // so the anchor re-scopes with the DTE toggle and redraws in replay (this runs there too).
      const kings = pickKingStrikes(walls);
      applyKingAnchor(series, kingCallLineRef, kings.call, v.callColor);
      applyKingAnchor(series, kingPutLineRef, kings.put, v.putColor);
      applyDarkPoolGuides(series, dpGuideRefs, []);
      void dp; // dark-pool level lines intentionally not drawn (clean axis); kept in the signature
      //         so callers/consumers of dp elsewhere are unaffected.
      // Feed the just-drawn strikes to the autoscale provider and nudge a rescale, so
      // the axis widens to reveal support/resistance walls the moment the lens/horizon
      // changes (off-hours there's no tick to trigger the recompute otherwise). Sliced to the
      // SHOWN count so the axis only widens for walls actually on screen — a 1m chart drawing 6
      // walls must not be stretched by the 7th–12th walls that only a higher timeframe reveals.
      rangeWallsRef.current = {
        call: (walls?.callWalls ?? []).slice(0, maxGuides).map((w) => w.strike),
        put: (walls?.putWalls ?? []).slice(0, maxGuides).map((w) => w.strike),
      };
      series.priceScale().applyOptions({ autoScale: true });
    },
    []
  );

  /**
   * Draw/refresh the enabled technical overlays against the CURRENTLY-shown bars. Called after every
   * applyDisplayBars (tick, timeframe, replay, seed) so the lines track the same aggregated bars the
   * candles use, and by the indicator-toggle effect so enabling/disabling repaints immediately.
   * One line series per enabled indicator, created lazily and removed the moment it's toggled off —
   * nothing is drawn while the (default-empty) enabled set is empty. Values are computed 1:1 with
   * the bars and the null warm-up region is dropped so lines simply start once defined.
   */
  const paintOverlays = useCallback((bars: VectorBar[]) => {
    const chart = chartRef.current;
    if (!chart || !seriesRef.current) return;
    lastDisplayBarsRef.current = bars;
    const enabled = indicatorsRef.current;
    const map = overlaySeriesRef.current;
    const closes = bars.map((b) => b.close);

    for (const def of VECTOR_OVERLAYS) {
      const existing = map.get(def.id) ?? null;
      if (!enabled.has(def.id)) {
        if (existing) {
          chart.removeSeries(existing);
          map.delete(def.id);
        }
        continue;
      }
      const values =
        def.kind === "vwap"
          ? vwapSeries(bars)
          : def.kind === "ema"
            ? emaSeries(closes, def.period ?? 0)
            : smaSeries(closes, def.period ?? 0);
      const data: { time: Time; value: number }[] = [];
      for (let i = 0; i < bars.length; i++) {
        const v = values[i];
        if (v != null) data.push({ time: bars[i]!.time, value: v });
      }
      let line = existing;
      if (!line) {
        line = chart.addSeries(LineSeries, {
          color: def.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        map.set(def.id, line);
      }
      line.setData(data);
    }

    // Draw the enabled "Key levels" horizontal lines from the SAME bars, on the candle series.
    if (seriesRef.current) {
      applyLevelLines(seriesRef.current, levelLinesRef.current, enabled, bars, priorDayRef.current);
    }
  }, []);

  // Sync the enabled-indicator set to the ref the imperative paint reads, and repaint immediately
  // against the currently-shown bars so toggling an indicator is instant (no wait for the next
  // tick/timeframe change). paintOverlays is stable, so this runs only when the selection changes.
  useEffect(() => {
    indicatorsRef.current = indicators;
    paintOverlays(lastDisplayBarsRef.current);
  }, [indicators, paintOverlays]);

  // Lazy prior-day OHLC fetch: only when a prior-day/pivot level is enabled, and only once per
  // ticker. The PDH/PDL/PDC + floor-pivot lines need the prior session's high/low/close, which the
  // session bars don't carry. On success, repaint so the lines appear without waiting for a tick.
  useEffect(() => {
    const needsPrior = VECTOR_LEVELS.some((l) => l.needsPriorDay && indicators.has(l.id));
    if (!needsPrior || (priorDayTickerRef.current === ticker && priorDayRef.current)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/market/vector/prior-day?ticker=${encodeURIComponent(ticker)}`);
        if (cancelled || !res.ok) return;
        const d = (await res.json()) as { pdh: number | null; pdl: number | null; pdc: number | null };
        if (cancelled) return;
        priorDayRef.current =
          d.pdh != null && d.pdl != null && d.pdc != null
            ? { pdh: d.pdh, pdl: d.pdl, pdc: d.pdc }
            : null;
        priorDayTickerRef.current = ticker;
        paintOverlays(lastDisplayBarsRef.current);
      } catch {
        /* best-effort — the prior-day/pivot lines simply don't draw if the fetch fails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [indicators, ticker, paintOverlays]);

  const toggleIndicator = useCallback((id: VectorIndicatorId) => {
    setIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearIndicators = useCallback(() => setIndicators(new Set()), []);

  const applyFrame = useCallback(
    (cursorTime: number, bars: VectorBar[], history: WallHistorySample[], activeLens: VectorWallLens) => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;

      const visibleBars = displayBarsFromMinute(bars, timeframeRef.current, cursorTime);
      applyDisplayBars(series, volumeSeriesRef.current, visibleBars);
      paintOverlays(visibleBars);

      // Horizon-aware replay: when the member has narrowed the DTE (GEX lens) and that horizon
      // has a recorded trail, replay THAT horizon's beads forming point-in-time — not the blended
      // "All" rail the callsites pass. So hitting replay on 0DTE/weekly/monthly reconstructs how
      // that specific horizon's clusters built through the session, matching what the live toggle
      // now draws (#187). VEX / "all" / no-recorded-trail fall back to the passed blended history.
      // Unlike the live composeHorizonTrail there is NO current-column union — replay must never
      // draw structure newer than the cursor, and the recorded trail is already point-in-time.
      const sourceHistory = pickReplayTrailSource(
        dteHorizonRef.current,
        activeLens,
        horizonHistoryRef.current,
        history
      );

      const visibleHistory = sliceHistoryToTime(sourceHistory, cursorTime);
      const v = lensVisuals(activeLens);
      const callStrikes = applyWallBeadMarkers(callBeadsRef.current, visibleHistory, "callWalls", v.callColor, activeLens, timeframeRef.current);
      const putStrikes = applyWallBeadMarkers(putBeadsRef.current, visibleHistory, "putWalls", v.putColor, activeLens, timeframeRef.current);
      // Same zoom-stability guarantee in replay: widen the axis for the beads this frame drew.
      beadStrikesRef.current = { call: callStrikes, put: putStrikes };
      pinCandlesOnTop(series);

      // initialWalls/etc are the page-load seed — a reasonable fallback only when the
      // session has genuinely recorded zero wall samples yet. Once history exists, a null
      // return from wallsAtReplayTime/flipAtReplayTime means cursorTime predates the
      // earliest sample; falling back to the seed would misattribute today's page-load-time
      // walls to that earlier point on the replay timeline (same bug shape as
      // wallsAtCrosshairTime above). Reads from sourceHistory so the flip line + wall guides
      // stay coherent with the horizon-scoped beads drawn above.
      const gexAt = sourceHistory.length > 0 ? wallsAtReplayTime(sourceHistory, cursorTime, "gex") : initialWalls;
      const vexAt = sourceHistory.length > 0 ? wallsAtReplayTime(sourceHistory, cursorTime, "vex") : initialVexWalls;
      const gammaAt = sourceHistory.length > 0 ? flipAtReplayTime(sourceHistory, cursorTime, "gex") : initialGammaFlip;
      const vexFlipAt = sourceHistory.length > 0 ? flipAtReplayTime(sourceHistory, cursorTime, "vex") : initialVexFlip;
      // Dark pool has no per-time history — darkPoolRef is TODAY's live ladder. Drawing
      // it on a historical frame mislabels live levels under the cursor timestamp
      // (walls/flip above are carefully time-honest; DP must not be the exception).
      refreshOverlays(activeLens, gexAt, vexAt, gammaAt, vexFlipAt, []);
    },
    [initialWalls, initialVexWalls, initialGammaFlip, initialVexFlip, refreshOverlays, paintOverlays]
  );

  const stopReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  // GEX walls to DRAW right now: the horizon-scoped fetch when the member has
  // narrowed the DTE, else the live stream walls. Replay/history paths bypass
  // this — they use the time-sliced recorded walls (which were recorded at the
  // full near-term scope), so the horizon override is a live-view concern only.
  const liveGexWalls = useCallback(
    (): VectorWalls | null =>
      pickHorizonScopedValue(dteHorizonRef.current, horizonWallsRef.current, gexWallsRef.current),
    []
  );

  // Gamma flip to DRAW right now — the horizon-scoped flip when the member has narrowed
  // the DTE (so the flip line re-scopes with the walls), else the live stream flip. Same
  // live-view-only scope as liveGexWalls: replay/history paths use time-sliced recorded flips.
  const liveGammaFlip = useCallback(
    (): number | null =>
      pickHorizonScopedValue(dteHorizonRef.current, horizonFlipRef.current, gammaFlipRef.current),
    []
  );

  // Compute the gamma regime from the current spot / flip / walls and emit it up to
  // the page banner. Uses the HORIZON-SCOPED view (liveGexWalls/liveGammaFlip) so the
  // banner describes exactly what the member is looking at: on "all" that's the near-
  // term stream, but when they narrow to 0DTE/weekly/monthly the regime read + flip
  // re-scope with the walls actually drawn on the chart. (User-requested coherence —
  // the terminal must adapt to the DTE selection, not narrate a different scope.)
  const emitRegime = useCallback(() => {
    if (!onRegimeChange) return;
    const walls = liveGexWalls();
    const regime = deriveVectorRegime({
      spot: spotRef.current,
      gammaFlip: liveGammaFlip(),
      topCallWall: walls?.callWalls?.[0]?.strike ?? null,
      topPutWall: walls?.putWalls?.[0]?.strike ?? null,
    });
    if (regime.read === lastRegimeReadRef.current) return;
    lastRegimeReadRef.current = regime.read;
    onRegimeChange(regime);
  }, [onRegimeChange, liveGexWalls, liveGammaFlip]);

  // Emit the nearest-wall proximity callout (dynamic desk-terminal pulse). Uses the
  // HORIZON-SCOPED walls + flip so "spot testing the 190 put wall" refers to the wall
  // the member's DTE selection actually surfaces — deduped by callout text so it only
  // fires when the actionable level actually changes.
  const emitProximity = useCallback(() => {
    if (!onProximityChange) return;
    const prox = deriveWallProximity({
      spot: spotRef.current,
      walls: liveGexWalls(),
      gammaFlip: liveGammaFlip(),
    });
    const key = prox ? `${prox.side}:${prox.strike}:${prox.nearness}` : "none";
    if (key === lastProximityRef.current) return;
    lastProximityRef.current = key;
    onProximityChange(prox);
  }, [onProximityChange, liveGexWalls, liveGammaFlip]);

  // Emit the gamma magnet (dealer-hedging center of mass) up to the desk terminal.
  // Regime posture drives the honest wording (pin in long gamma, pivot in short),
  // so it's derived here from the SAME horizon-scoped walls/flip as the regime banner
  // (liveGexWalls/liveGammaFlip) — the magnet's center of mass re-computes over the
  // walls the member's DTE selection surfaces. Deduped by the level+pull+posture key.
  const emitMagnet = useCallback(() => {
    if (!onMagnetChange) return;
    const walls = liveGexWalls();
    const regime = deriveVectorRegime({
      spot: spotRef.current,
      gammaFlip: liveGammaFlip(),
      topCallWall: walls?.callWalls?.[0]?.strike ?? null,
      topPutWall: walls?.putWalls?.[0]?.strike ?? null,
    });
    const magnet = deriveGammaMagnet({ spot: spotRef.current, walls, posture: regime.posture });
    const key = magnet ? `${magnet.strike}:${magnet.pull}:${magnet.posture}` : "none";
    if (key === lastMagnetRef.current) return;
    lastMagnetRef.current = key;
    onMagnetChange(magnet);
  }, [onMagnetChange, liveGexWalls, liveGammaFlip]);

  // Emit top-wall integrity (is this wall real?) — strength × session persistence
  // (from the same history rail the trails use) × isolation. Scores the HORIZON-SCOPED
  // top walls (liveGexWalls) so the readout matches the walls on the chart. Note: the
  // persistence component reads the near-term-scoped recorded rail (wallHistoryRef), so
  // for a narrowed horizon whose top wall sits at a strike the rail never recorded,
  // persistence is best-effort — strength + isolation still score it honestly, and a
  // strike the rail did track still gets full persistence credit. Deduped by tier+score.
  const emitWallIntegrity = useCallback(() => {
    if (!onWallIntegrityChange) return;
    const integ = scoreTopWalls(liveGexWalls(), wallHistoryRef.current);
    const key = `${integ.call?.strike ?? "-"}:${integ.call?.tier ?? "-"}:${integ.call?.score ?? "-"}|${integ.put?.strike ?? "-"}:${integ.put?.tier ?? "-"}:${integ.put?.score ?? "-"}`;
    if (key === lastWallIntegrityRef.current) return;
    lastWallIntegrityRef.current = key;
    onWallIntegrityChange(integ);
  }, [onWallIntegrityChange, liveGexWalls]);

  // DTE horizon → repaint GEX walls. "all" follows the live stream; a narrower
  // horizon fetches expiry-scoped walls on demand (keeping the shared per-second
  // SSE stream untouched) and repaints, refreshing on an interval while live.
  useEffect(() => {
    dteHorizonRef.current = dteHorizon;
    let cancelled = false;

    // A selection change (DTE horizon or ticker — this effect's own deps) must ALWAYS repaint the
    // terminal, even if the new scope happens to yield the same coarse dedup key as the last emit.
    // The emit dedup refs persist for the component's life, so without this reset a toggle whose
    // read collides with the prior one is SWALLOWED and the terminal stays on the old selection
    // until a full page refresh clears the refs — exactly the "had to refresh" report. Clearing them
    // here guarantees the first post-selection emit fires; steady-state SSE dedup is unaffected.
    lastRegimeReadRef.current = "";
    lastProximityRef.current = "";
    lastMagnetRef.current = "";
    lastWallIntegrityRef.current = "";

    const repaintLive = () => {
      if (replayModeRef.current || !seriesRef.current) return;
      refreshOverlays(
        lensRef.current,
        liveGexWalls(),
        vexWallsRef.current,
        liveGammaFlip(),
        vexFlipRef.current,
        darkPoolRef.current
      );
      // Repaint the BEADS on the horizon toggle too — refreshTrails is now horizon-aware, so a
      // narrowed horizon redraws the scoped walls instead of the blended "All" rail. Without this,
      // the toggle re-scoped only the flip line + terminal and the beads stayed on "All" (the bug).
      refreshTrails(lensRef.current);
      // Re-derive the desk-terminal narration against the just-scoped walls/flip so the
      // regime banner, magnet, proximity, and integrity all snap to the new DTE horizon
      // the instant the member toggles it — not on the next SSE tick. Each emit is
      // self-deduped, so switching back to a horizon that yields the same reads is a no-op.
      emitRegime();
      emitProximity();
      emitMagnet();
      emitWallIntegrity();
    };

    // Repaint dispatcher: in replay a DTE toggle must redraw the CURRENT cursor frame (not the
    // live tape) so the horizon-scoped beads swap in immediately — applyFrame picks the per-horizon
    // source from dteHorizonRef + horizonHistoryRef, so re-applying the frame is all that's needed.
    // Mirrors the lens effect's in-replay applyFrame call. Off replay this is the live repaint.
    const repaint = () => {
      if (replayModeRef.current) {
        if (!seriesRef.current) return;
        const t = timelineRef.current[cursorIndexRef.current];
        if (t != null) applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
        return;
      }
      repaintLive();
    };

    if (dteHorizon === "all") {
      horizonWallsRef.current = null;
      horizonFlipRef.current = null;
      horizonHistoryRef.current = [];
      repaint();
      return;
    }

    // Clear any prior horizon's recorded trail up front so a toggle never briefly shows the
    // previous horizon's clusters while this fetch is in flight.
    horizonHistoryRef.current = [];

    // Fetch the RECORDED per-horizon trail (frozen clusters) in parallel with the current walls.
    // Separate from fetchScoped so a slow/empty history read never delays the current-structure
    // repaint. Guarded on the still-active horizon + not cancelled, same as fetchScoped.
    const fetchHistory = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/wall-history?ticker=${encodeURIComponent(ticker)}&dte=${dteHorizon}` +
            `&session=${encodeURIComponent(sessionYmd)}`
        );
        if (cancelled || dteHorizonRef.current !== dteHorizon || !res.ok) return;
        const data = (await res.json()) as { history?: WallHistorySample[] };
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        horizonHistoryRef.current = Array.isArray(data.history) ? data.history : [];
        repaint();
      } catch {
        // History is a supplementary overlay — on any failure keep the single-column fallback
        // (horizonHistoryRef stays []), which refreshTrails already draws. No repaint needed.
      }
    };

    const fetchScoped = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/walls?ticker=${encodeURIComponent(ticker)}&dte=${dteHorizon}`
        );
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        if (!res.ok) {
          // Fetch reachable but errored (e.g. 5xx). Still repaint against the live stream values
          // (liveGexWalls/liveGammaFlip fall back to the un-scoped stream), so the terminal reflects
          // the CURRENT selection instead of freezing on the previous horizon's narration.
          repaintLive();
          return;
        }
        const data = (await res.json()) as { walls?: VectorWalls | null; flip?: number | null };
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        horizonWallsRef.current = data.walls ?? null;
        // Re-scope the flip line with the horizon too. A null flip (e.g. no ladder
        // zero-crossing in the scoped expiries) falls back to the live stream flip
        // via liveGammaFlip, so the flip never vanishes just because a horizon narrowed.
        horizonFlipRef.current = data.flip ?? null;
        repaintLive();
      } catch {
        // Network throw: keep last-known scoped walls/flip, but STILL repaint so the terminal
        // re-derives against the current selection (stream fallback) rather than staying stale.
        if (!cancelled && dteHorizonRef.current === dteHorizon) repaintLive();
      }
    };

    void fetchScoped();
    void fetchHistory();
    // Only the current walls need the 15s cadence; the recorded trail advances at the recorder's
    // 5-min bucket, so refresh it on a slower interval in RTH (and once, above, off-hours).
    const id = liveSession ? setInterval(fetchScoped, 15_000) : null;
    const histId = liveSession ? setInterval(fetchHistory, 60_000) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
      if (histId) clearInterval(histId);
    };
  }, [
    dteHorizon,
    ticker,
    sessionYmd,
    liveSession,
    // chartReady: at mount this effect runs BEFORE the chart-creation effect builds the series, so
    // repaintLive() bails on !seriesRef.current and the terminal stays blank until the first SSE
    // frame — which never arrives in a closed session (→ "had to refresh"). Re-running once the
    // series exists fires the initial emits against the SSR-seeded walls/spot refs.
    chartReady,
    applyFrame,
    refreshOverlays,
    refreshTrails,
    liveGexWalls,
    liveGammaFlip,
    emitRegime,
    emitProximity,
    emitMagnet,
    emitWallIntegrity,
  ]);

  // Lens (GEX↔VEX) is a selection too: re-derive the terminal so the lens-gated wall-integrity line
  // (and the rest) reflect the new lens immediately, not on the next SSE frame — which never arrives
  // in a closed session, forcing the member to refresh. Reset the dedup keys so the switch can't be
  // swallowed by a coincidental key match. Placed after the emit callbacks are declared (they read
  // lensRef, synced above) and guarded on the series existing / not replaying.
  useEffect(() => {
    if (!chartReady || replayModeRef.current || !seriesRef.current) return;
    lastRegimeReadRef.current = "";
    lastProximityRef.current = "";
    lastMagnetRef.current = "";
    lastWallIntegrityRef.current = "";
    emitRegime();
    emitProximity();
    emitMagnet();
    emitWallIntegrity();
  }, [lens, chartReady, emitRegime, emitProximity, emitMagnet, emitWallIntegrity]);

  const connectLive = useCallback(() => {
    if (!liveSessionRef.current) return;
    connRef.current?.close();

    // Closed-bar backfill on every (re)connect: the SSE only carries the
    // currently-forming candle, so bars that closed while disconnected
    // (reconnect crossing a minute boundary, tab sleep) — and the bar Polygon
    // hadn't published yet at SSR time — were permanent holes corrupting
    // higher-timeframe aggregates. Fire-and-forget; merge is idempotent.
    void fetch(`/api/market/vector/bars?ticker=${encodeURIComponent(ticker)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { bars?: VectorBar[]; sessionYmd?: string };
        if (!data.bars?.length || data.sessionYmd !== sessionYmd) return;
        const merged = mergeBarsByTime(minuteBarsRef.current, data.bars);
        if (merged === minuteBarsRef.current) return;
        minuteBarsRef.current = merged;
        setSessionBars(merged);
        if (!replayModeRef.current && seriesRef.current) {
          const display = displayBarsFromMinute(merged, timeframeRef.current);
          displayBarTimeRef.current = display[display.length - 1]?.time ?? 0;
          applyDisplayBars(seriesRef.current, volumeSeriesRef.current, display);
          paintOverlays(display);
        }
      })
      .catch(() => {
        /* best-effort — live ticks keep flowing regardless */
      });

    let lastMinuteBarTime = minuteBarsRef.current.length
      ? minuteBarsRef.current[minuteBarsRef.current.length - 1]!.time
      : 0;

    connRef.current = createVectorEventSource(ticker, (snap) => {
      if (snap.sessionYmd && snap.sessionYmd !== sessionYmd) return;
      if (!liveSessionRef.current) return;
      // During replay the connection stays OPEN and every branch below keeps
      // accumulating into refs/state — only chart PAINTS are gated. Closing the
      // stream (the old behavior) permanently lost every bar that closed while
      // the member was in replay: nothing backfills bars on reconnect, so a
      // 10-minute replay left a 10-bar hole in the session for the rest of the
      // day, silently corrupting higher-timeframe OHLC aggregates.
      const inReplay = replayModeRef.current;

      if (snap.wallHistory?.length) {
        const prevTail = wallHistoryRef.current[wallHistoryRef.current.length - 1];
        const merged = mergeWallHistory(wallHistoryRef.current, snap.wallHistory);
        if (merged !== wallHistoryRef.current) {
          const newTail = merged[merged.length - 1];
          if (prevTail && newTail) {
            for (const active of ["gex", "vex"] as const) {
              const incoming = diffVectorWallSample(prevTail, newTail, active);
              if (incoming.length) {
                setWallEvents((ev) => appendVectorWallEvents(ev, incoming));
              }
            }
          }
          wallHistoryRef.current = merged;
          setSessionHistory(merged);
          if (hasVexInHistory(merged)) setVexAvailable(true);
          if (!inReplay) refreshTrails(lensRef.current);
        }
      }

      if (snap.t) {
        onFreshness?.(snap.t);
      }
      if (snap.gexAsOf != null) {
        setGexAsOf(snap.gexAsOf);
      }
      if (snap.vexAsOf != null) {
        setVexAsOf(snap.vexAsOf);
      }

      if (snap.gammaFlip !== undefined) {
        gammaFlipRef.current = snap.gammaFlip ?? null;
      }
      if (snap.vexFlip !== undefined) {
        vexFlipRef.current = snap.vexFlip ?? null;
      }
      if (snap.darkPoolLevels) {
        darkPoolRef.current = snap.darkPoolLevels;
      }
      // Capture the PREVIOUS tick's structure before overwriting — spot-break
      // detection requires the level to have been stable across the tick (a
      // wall relocating across a flat spot is not a breakout).
      const prevStruct = {
        gexWalls: gexWallsRef.current,
        vexWalls: vexWallsRef.current,
        gammaFlip: gammaFlipRef.current,
        vexFlip: vexFlipRef.current,
      };
      if (snap.walls) {
        gexWallsRef.current = snap.walls;
      }
      if (snap.vexWalls) {
        vexWallsRef.current = snap.vexWalls;
        if (snap.vexWalls.callWalls?.length || snap.vexWalls.putWalls?.length) {
          setVexAvailable(true);
        }
      }

      if (snap.candle && snap.candle.time >= lastMinuteBarTime) {
        lastMinuteBarTime = snap.candle.time;
        const curSpot = snap.candle.close;
        const prevSpot = spotRef.current;
        for (const active of ["gex", "vex"] as const) {
          const spotEvents = detectSpotStructureEvents(
            prevSpot,
            curSpot,
            wallsForActiveLens(active, gexWallsRef.current, vexWallsRef.current),
            flipForActiveLens(active, gammaFlipRef.current, vexFlipRef.current),
            active,
            snap.candle.time,
            wallsForActiveLens(active, prevStruct.gexWalls, prevStruct.vexWalls),
            flipForActiveLens(active, prevStruct.gammaFlip, prevStruct.vexFlip)
          );
          if (spotEvents.length) {
            setWallEvents((ev) => appendVectorWallEvents(ev, spotEvents));
          }
        }
        spotRef.current = curSpot;
        minuteBarsRef.current = upsertBar(minuteBarsRef.current, snap.candle as VectorBar);
        setSessionBars(minuteBarsRef.current);
        if (!inReplay) {
          const displayBars = displayBarsFromMinute(minuteBarsRef.current, timeframeRef.current);
          const lastDisplay = displayBars[displayBars.length - 1];
          if (lastDisplay) {
            displayBarTimeRef.current = lastDisplay.time;
            seriesRef.current?.update(lastDisplay);
            volumeSeriesRef.current?.setData(volumeHistogramData(displayBars));
          }
        }
      }

      // Painting the live overlays during replay would overwrite the cursor-sliced
      // frame applyFrame just drew — same leak shape as the 2026-07-07 finding.
      if (!inReplay) {
        refreshOverlays(
          lensRef.current,
          liveGexWalls(),
          vexWallsRef.current,
          liveGammaFlip(),
          vexFlipRef.current,
          darkPoolRef.current
        );
        emitRegime();
        emitProximity();
        emitMagnet();
        emitWallIntegrity();
      }
    });
  }, [sessionYmd, refreshTrails, refreshOverlays, onFreshness, ticker, liveGexWalls, liveGammaFlip, emitRegime, emitProximity, emitMagnet, emitWallIntegrity, paintOverlays]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      // Pin the axis locale instead of inheriting navigator.language — a rejected default
      // tag (e.g. "en-US@posix") throws inside the chart's Intl-based time-axis formatting
      // and blanks the whole canvas. See vector-chart-config.ts for the full write-up.
      localization: { locale: VECTOR_CHART_LOCALE },
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9fb4d4",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        // Subtle live follow when the last bar is visible — do not call scrollToRealTime on every new bar.
        shiftVisibleRangeOnNewBar: true,
        // Leave whitespace between the last candle and the price axis so the bead bands stop short
        // of the axis (Skylit-style) instead of running flush into it.
        rightOffset: VECTOR_RIGHT_OFFSET_BARS,
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
      crosshair: {
        vertLine: { color: "rgba(34, 211, 238, 0.35)", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "rgba(34, 211, 238, 0.35)", width: 1, style: LineStyle.Dashed },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#00e676",
      downColor: "#ff2d55",
      borderVisible: false,
      wickUpColor: "#00e676",
      wickDownColor: "#ff2d55",
      priceLineVisible: false,
      lastValueVisible: true,
      // Widen the auto-fitted candle range to also include the drawn walls within
      // ±WALL_VIEW_MAX_PCT of spot, so put (support) walls below the candle band
      // are visible instead of clipped. Pure union — never narrows the candle range.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (!res || !res.priceRange) return res;
        // Two composed widenings (each only ever WIDENS, never narrows the candle band):
        // 1) the current live ladder (rangeWallsRef) within the tight ±WALL_VIEW_MAX_PCT window;
        // 2) the strikes ACTUALLY drawn as beads (beadStrikesRef) within the wider BEAD_VIEW_MAX_PCT.
        // (2) is what keeps beads from vanishing on zoom: autoscale re-runs on every zoom off the
        // now-fewer visible candles, and without covering the drawn-bead strikes a bead outside the
        // ladder range clipped out and reappeared on zoom-back. Covering the drawn set makes the
        // rail stable at every zoom (Skylit wide-rail look).
        const ladderRange = extendRangeForWalls(
          res.priceRange,
          spotRef.current,
          rangeWallsRef.current.call,
          rangeWallsRef.current.put,
          WALL_VIEW_MAX_PCT
        );
        return {
          ...res,
          priceRange: extendRangeForWalls(
            ladderRange,
            spotRef.current,
            beadStrikesRef.current.call,
            beadStrikesRef.current.put,
            BEAD_VIEW_MAX_PCT,
            BEAD_VIEW_MAX_PCT
          ),
        };
      },
    }, 0);

    // TradingView-style volume strip — overlay on pane 0 (LWC documented pattern).
    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        lastValueVisible: false,
        priceLineVisible: false,
      },
      0
    );
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.72, bottom: 0 },
    });

    const initialDisplay = displayBarsFromMinute(initialBars, 1);
    applyDisplayBars(series, volumeSeries, initialDisplay);
    paintOverlays(initialDisplay);
    displayBarTimeRef.current = initialBars[initialBars.length - 1]?.time ?? 0;
    if (initialBars.length) chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    setChartReady(true);
    callBeadsRef.current = createSeriesMarkers(series, []);
    putBeadsRef.current = createSeriesMarkers(series, []);

    refreshTrails("gex");
    refreshOverlays("gex", initialWalls, initialVexWalls, initialGammaFlip, initialVexFlip, initialDarkPoolLevels);
    pinCandlesOnTop(series);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setCrosshair(null);
        return;
      }
      const bar = param.seriesData.get(series) as VectorBar | undefined;
      const time =
        typeof param.time === "number"
          ? formatReplayClock(param.time)
          : String(param.time);
      const activeLens = lensRef.current;
      const hoverEpochSec = typeof param.time === "number" ? param.time : null;
      const history = wallHistoryRef.current;
      const walls = wallsAtCrosshairTime(
        history,
        hoverEpochSec,
        activeLens,
        gexWallsRef.current,
        vexWallsRef.current
      );
      setCrosshair({
        time,
        close: bar?.close ?? null,
        lens: activeLens,
        flip: flipAtCrosshairTime(
          history,
          hoverEpochSec,
          activeLens,
          gammaFlipRef.current,
          vexFlipRef.current
        ),
        callWalls: walls?.callWalls ?? [],
        putWalls: walls?.putWalls ?? [],
        // No DP history exists — only today's live ladder. Walls/flip above resolve
        // to their value AT the hovered time; showing live DP under a historical
        // hover timestamp would mislabel it. Show DP only when hovering the present
        // (at/after the latest recorded sample, or before any history exists).
        darkPoolLevels:
          hoverEpochSec == null ||
          history.length === 0 ||
          hoverEpochSec >= (history[history.length - 1]?.time ?? 0)
            ? darkPoolRef.current
            : [],
      });
    });

    if (liveSession) connectLive();

    return () => {
      stopReplayTimer();
      connRef.current?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      callGuideRefs.current = emptyGuideRefs();
      putGuideRefs.current = emptyGuideRefs();
      dpGuideRefs.current = [];
      flipGuideRef.current = null;
      // chart.remove() disposes the series (and its price lines) — just drop the stale refs so a
      // remount (ticker switch) starts clean instead of calling removePriceLine on a dead series.
      kingCallLineRef.current = null;
      kingPutLineRef.current = null;
      // chart.remove() disposes the overlay line series too — swap in a fresh map so a remount
      // rebuilds instead of touching the now-disposed series (matches the sibling ref resets).
      overlaySeriesRef.current = new Map();
      levelLinesRef.current = new Map();
      priorDayRef.current = null;
      priorDayTickerRef.current = null;
      callBeadsRef.current = null;
      putBeadsRef.current = null;
      volumeSeriesRef.current = null;
      setChartReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * SPY volume backfill — merges SPY 1m volume onto SPX bars (idempotent; the index has no
   * native tape volume, see mergeSpyVolumeRows). Polls every SPY_VOLUME_BACKFILL_MS rather
   * than running once at mount: /api/market/vector/spy-volume?ymd=... only ever returns
   * CLOSED Polygon minute bars (the currently-forming bar has no row yet), so a mount-only
   * fetch permanently misses the volume for every bar that closes AFTER that one call —
   * confirmed live: the histogram silently stopped updating for the rest of the session
   * after initial page load, contradicting the "live SPY volume" pane the page advertises.
   * Each poll re-fetches the whole day fresh from Polygon (no caching in fetchSpyVolumeRows)
   * and mergeSpyVolumeRows only touches bars with a newly-available positive volume, so
   * repeated polling is safe/idempotent — this just picks up each newly-closed bar's volume
   * as the session progresses, same cadence as spyVolumeForMinuteBar's own 55s server cache.
   */
  useEffect(() => {
    if (!chartReady || ticker !== "SPX") return;
    let cancelled = false;
    const backfill = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/spy-volume?ymd=${encodeURIComponent(sessionYmd)}`
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          volumes?: Array<{ time: number; volume: number }>;
        };
        if (!data.volumes?.length || cancelled) return;
        const merged = mergeSpyVolumeRows(minuteBarsRef.current, data.volumes);
        if (!merged.some((b) => b.volume != null && b.volume > 0)) return;
        minuteBarsRef.current = merged;
        setSessionBars(merged);
        // REPLAY GUARD: this poll fires every 60s regardless of mode. Painting here
        // with no cursorTime slice repaints the FULL live bar array — during replay
        // that silently leaks every bar through "now" onto a chart whose clock label
        // still reads the cursor time (the exact 2026-07-07 leak, re-entering through
        // this effect). Merge into refs/state above is safe and wanted (post-replay
        // display picks it up); the paint must be live-mode only.
        if (replayModeRef.current) return;
        const display = displayBarsFromMinute(merged, timeframeRef.current);
        applyDisplayBars(seriesRef.current!, volumeSeriesRef.current, display);
        paintOverlays(display);
      } catch {
        /* best-effort */
      }
    };
    void backfill();
    const interval = setInterval(backfill, SPY_VOLUME_BACKFILL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [chartReady, sessionYmd, ticker, paintOverlays]);

  useEffect(() => {
    if (!replayMode || !playing || timelineRef.current.length === 0) {
      stopReplayTimer();
      return;
    }
    replayTimerRef.current = setInterval(() => {
      const next = cursorIndexRef.current + 1;
      if (next >= timelineRef.current.length) {
        if (replayLoop) {
          const t0 = timelineRef.current[0]!;
          applyFrame(t0, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
          cursorIndexRef.current = 0;
          setCursorIndex(0);
          return;
        }
        setPlaying(false);
        return;
      }
      const t = timelineRef.current[next]!;
      applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
      cursorIndexRef.current = next;
      setCursorIndex(next);
    }, REPLAY_STEP_MS / Math.max(0.25, replaySpeed));

    return stopReplayTimer;
  }, [replayMode, playing, replaySpeed, replayLoop, applyFrame, stopReplayTimer]);

  const replayTimeline = buildReplayTimeline(sessionHistory, sessionBars);
  const canReplay = replayTimeline.length > 1;

  const enterReplay = () => {
    // The SSE connection stays OPEN during replay — the handler keeps accumulating
    // bars/history/events into refs (so nothing is lost while browsing) and gates
    // every paint on replayModeRef. Set the ref synchronously: an SSE message can
    // arrive between this render being scheduled and the sync effect running, and
    // an un-gated paint here would overwrite the frame drawn below.
    replayModeRef.current = true;
    timelineRef.current = replayTimeline;
    setReplayMode(true);
    setPlaying(false);
    cursorIndexRef.current = 0;
    setCursorIndex(0);
    if (replayTimeline.length > 0) {
      applyFrame(replayTimeline[0]!, minuteBarsRef.current, wallHistoryRef.current, lens);
    }
  };

  const exitReplay = () => {
    stopReplayTimer();
    replayModeRef.current = false;
    setReplayMode(false);
    setPlaying(false);
    const bars = minuteBarsRef.current;
    const display = displayBarsFromMinute(bars, timeframeRef.current);
    displayBarTimeRef.current = display[display.length - 1]?.time ?? 0;
    if (seriesRef.current) {
      applyDisplayBars(seriesRef.current, volumeSeriesRef.current, display);
      paintOverlays(display);
    }
    const history = wallHistoryRef.current;
    refreshTrails(lens);
    const tail = history[history.length - 1]?.time ?? 0;
    refreshOverlays(
      lens,
      wallsAtReplayTime(history, tail, "gex") ?? initialWalls,
      wallsAtReplayTime(history, tail, "vex") ?? initialVexWalls,
      flipAtReplayTime(history, tail, "gex") ?? initialGammaFlip,
      flipAtReplayTime(history, tail, "vex") ?? initialVexFlip,
      darkPoolRef.current
    );
    chartRef.current?.timeScale().fitContent();
    // Connection was kept open through replay; only reconnect if it actually dropped.
    if (!connRef.current) connectLive();
  };

  const toggleReplay = () => {
    if (replayMode) exitReplay();
    else enterReplay();
  };

  const scrubTo = (index: number) => {
    setPlaying(false);
    const clamped = clampTimelineIndex(timelineRef.current, index);
    cursorIndexRef.current = clamped;
    setCursorIndex(clamped);
    const t = timelineRef.current[clamped];
    if (t != null) applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lens);
  };

  const stepReplay = (delta: number) => {
    setPlaying(false);
    const clamped = clampTimelineIndex(timelineRef.current, cursorIndexRef.current + delta);
    const t = timelineRef.current[clamped];
    if (t != null) applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
    cursorIndexRef.current = clamped;
    setCursorIndex(clamped);
  };

  const jumpReplayOpen = () => {
    scrubTo(timelineIndexAtOrAfterEtClock(timelineRef.current, sessionYmd, 9, 30));
  };

  const jumpReplayClose = () => {
    scrubTo(timelineIndexAtOrBeforeEtClock(timelineRef.current, sessionYmd, 16, 0));
  };

  useEffect(() => {
    if (!replayMode) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        e.preventDefault();
        toggleReplay();
        return;
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepReplay(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        stepReplay(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayMode]);

  const stepCount = replayMode ? timelineRef.current.length : replayTimeline.length;
  const cursorTime = timelineRef.current[cursorIndex] ?? 0;
  const clockLabel = cursorTime ? formatReplayClock(cursorTime) : "—";

  // Honesty label: any modeled (reconstructed) bead currently in the trail means the member is
  // looking at a mix of modeled + recorded structure — say so explicitly. As live observed
  // samples overwrite the modeled buckets (mergeWallHistory in the SSE handler drops the modeled
  // flag), a fully-observed trail flips this false and the caption disappears on its own.
  const hasModeledBeads = sessionHistory.some((s) => s.modeled === true);

  useEffect(() => {
    if (replayMode) {
      // Lens buttons stay enabled in replay; without a repaint the toolbar/legend
      // switch to the new lens while the drawn walls/beads/flip stay on the OLD
      // lens until the next scrub. Redraw the current frame under the new lens.
      const t = timelineRef.current[cursorIndexRef.current];
      if (t != null) applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lens);
      return;
    }
    refreshTrails(lens);
    refreshOverlays(
      lens,
      liveGexWalls(),
      vexWallsRef.current,
      liveGammaFlip(),
      vexFlipRef.current,
      darkPoolRef.current
    );
  }, [lens, replayMode, refreshTrails, refreshOverlays, applyFrame, liveGexWalls, liveGammaFlip]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series) return;
    if (replayMode) {
      // This effect also re-fires on entering/exiting replay (replayMode is a dep) —
      // e.g. right after enterReplay()'s own applyFrame(replayTimeline[0], ...) call.
      // Re-deriving display bars from the FULL live minuteBarsRef.current (as the live
      // branch below does) would immediately overwrite that correctly cursor-sliced
      // frame with every bar through "now", including bars after the replay cursor —
      // leaking live/future price action into a view whose clock label still reads the
      // earlier cursor time. Route through applyFrame so the slice stays honest.
      applyFrame(cursorTime, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
    } else {
      const display = displayBarsFromMinute(minuteBarsRef.current, timeframe);
      displayBarTimeRef.current = display[display.length - 1]?.time ?? 0;
      applyDisplayBars(series, volumeSeriesRef.current, display);
      paintOverlays(display);
      // Re-fit the time scale to the new bar COUNT. A higher timeframe has far fewer bars (a 6.5h
      // session ≈ 390 1m bars but only ~26 at 15m), and lightweight-charts keeps the previous
      // per-bar pixel spacing — so without a refit those few bars stay crammed into the right edge
      // with a huge empty gap on the left, and the price-following overlays (VWAP/EMA/SMA) get
      // squished into that sliver and look absent. fitContent recomputes the spacing so the bars —
      // and their overlays — fill the chart width at every timeframe.
      chart?.timeScale().fitContent();
      refreshTrails(lensRef.current);
      // Repaint the wall GUIDES too: the shown-count (wallCountForTimeframe) changes with the
      // timeframe, so a pure timeframe switch (no lens/tick change) must redraw the call/put
      // price lines — growing the count on an upshift, and clearing the now-extra lines on a
      // downshift. refreshTrails above already rescaled the beads; without this the guides
      // would stay frozen at the previous timeframe's count until the next SSE tick.
      refreshOverlays(
        lensRef.current,
        liveGexWalls(),
        vexWallsRef.current,
        liveGammaFlip(),
        vexFlipRef.current,
        darkPoolRef.current
      );
      if (liveSession) {
        maybeScrollToLive(chart);
      }
    }
    chart?.timeScale().applyOptions({ secondsVisible: timeframe === 1 });
    // cursorTime intentionally omitted: scrubTo/stepReplay/the replay timer already call
    // applyFrame imperatively on every cursor change, so re-running this effect for that
    // too would just double the work; it only needs the CURRENT cursorTime on the renders
    // where timeframe/replayMode/liveSession actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe, replayMode, liveSession, refreshTrails, refreshOverlays, applyFrame, liveGexWalls, liveGammaFlip]);

  const handleLens = (next: VectorWallLens) => {
    if (next === "vex" && !vexAvailable) return;
    setLens(next);
  };

  return (
    <div className="vector-chart-wrap">
      {!initialBars.length && (
        <p className="mb-3 font-mono text-xs text-sky-300">
          No SPX session bars available yet — wall beads, flip, and dark-pool levels load when data is present.
        </p>
      )}

      <VectorToolbar
        interval={timeframe}
        onInterval={setTimeframe}
        timeframeDisabled={replayMode}
        lens={lens}
        vexAvailable={vexAvailable}
        onLens={handleLens}
        dteHorizon={dteHorizon}
        onDteHorizon={(h) => setDteHorizon(normalizeDteHorizon(h))}
        dteAvailable={dteAvailable}
        gexAsOf={gexAsOf}
        vexAsOf={vexAsOf}
        liveSession={liveSession && !replayMode}
        replayMode={replayMode}
        playing={playing}
        canReplay={canReplay}
        cursorIndex={cursorIndex}
        stepCount={stepCount}
        clockLabel={clockLabel}
        speed={replaySpeed}
        loop={replayLoop}
        onToggleReplay={toggleReplay}
        onTogglePlay={() => setPlaying((p) => !p)}
        onScrub={scrubTo}
        onSpeed={setReplaySpeed}
        onStep={stepReplay}
        onJumpOpen={jumpReplayOpen}
        onJumpClose={jumpReplayClose}
        onToggleLoop={() => setReplayLoop((v) => !v)}
        indicators={indicators}
        onToggleIndicator={toggleIndicator}
        onClearIndicators={clearIndicators}
      />

      <div className="relative">
        <VectorCrosshairLegend state={crosshair} ticker={ticker} />
        <p className="pointer-events-none absolute bottom-2 left-2 z-10 font-mono text-[10px] uppercase tracking-wide text-sky-300">
          SPY vol
        </p>
        {/* Honesty label — visible whenever any modeled (reconstructed) bead is on screen, absent
            once the trail is fully observed. Matches the SPY-vol caption's font-mono/opacity style. */}
        {hasModeledBeads && (
          <p className="pointer-events-none absolute bottom-2 right-2 z-10 font-mono text-[10px] uppercase tracking-wide text-sky-300/70">
            ◇ dim = modeled · ● solid = recorded
          </p>
        )}
        {/* Off-hours the candles are the last close's and the chart can read as
            empty. A quiet corner affordance names the state and points at the
            one useful off-hours action — replay the session. */}
        {!liveSession && !replayMode && canReplay && (
          <button
            type="button"
            className="vector-chart-closed-hint"
            onClick={toggleReplay}
          >
            <span className="vector-chart-closed-dot" aria-hidden="true" />
            Session closed — last-close structure. Replay the day ▸
          </button>
        )}
        <div
          ref={containerRef}
          className="vector-chart-canvas"
          style={{ height: "calc(100vh - 200px)", minHeight: 480 }}
          aria-busy={liveSession && !replayMode}
        />
      </div>
    </div>
  );
}
