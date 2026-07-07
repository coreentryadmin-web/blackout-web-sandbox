"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { VectorCrosshairLegend, type VectorCrosshairState } from "@/components/vector/VectorCrosshairLegend";
import { VectorLensToggle } from "@/components/vector/VectorLensToggle";
import { VectorReplayControls } from "@/components/vector/VectorReplayControls";
import { VectorTimeframeToggle } from "@/components/vector/VectorTimeframeToggle";
import { VectorWallEventTicker } from "@/components/vector/VectorWallEventTicker";
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
} from "@/lib/providers/vector-wall-events";
import { alphaForPct, radiusForPct, widthForPct } from "@/lib/providers/vector-wall-visual";
import {
  hasVexInHistory,
  liveTrailAnchorSec,
  mergeWallHistory,
  pickActiveStrikes,
  trailsByStrike,
  trimHistoryForLiveTrails,
  type VectorWallLens,
  type WallHistorySample,
} from "@/lib/providers/vector-wall-history";
import {
  buildReplayTimeline,
  flipAtReplayTime,
  formatReplayClock,
  sliceBarsToTime,
  sliceHistoryToTime,
  wallsAtReplayTime,
} from "@/lib/vector-replay";
import {
  aggregateVectorBars,
  type VectorTimeframeMinutes,
} from "@/lib/vector-bar-timeframes";

export type VectorBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

const PUT_WALL_COLOR = "#b26bff";
const CALL_WALL_COLOR = "#ffd60a";
const VEX_POS_COLOR = "#7dd3fc";
const VEX_NEG_COLOR = "#fb7185";
const GAMMA_FLIP_COLOR = "#22d3ee";
const VANNA_FLIP_COLOR = "#38bdf8";
const DARK_POOL_COLOR = "#00d4ff";
const REPLAY_STEP_MS = 350;
const MAX_WALL_GUIDES = 6;
const MAX_DP_GUIDES = 6;

type Props = {
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

function wallsForActiveLens(
  lens: VectorWallLens,
  gex: VectorWalls | null,
  vex: VectorWalls | null
): VectorWalls | null {
  return lens === "vex" ? vex : gex;
}

function flipForActiveLens(
  lens: VectorWallLens,
  gammaFlip: number | null,
  vexFlip: number | null
): number | null {
  return lens === "vex" ? vexFlip : gammaFlip;
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
  label: string
): void {
  applyPriceGuides(
    series,
    guideRefs,
    levels.slice(0, MAX_WALL_GUIDES).map((l) => ({ ...l, label })),
    baseColor,
    MAX_WALL_GUIDES,
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
  if (lineRef.current) {
    lineRef.current.applyOptions({
      price: flip,
      title,
      color: lineColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: false,
      axisLabelVisible: true,
    });
  } else {
    lineRef.current = series.createPriceLine({
      price: flip,
      color: lineColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: false,
      axisLabelVisible: true,
      title,
    });
  }
}

function applyWallsToSeries(
  series: ISeriesApi<"Candlestick">,
  callGuideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  putGuideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  walls: VectorWalls | null | undefined,
  lens: VectorWallLens
): void {
  if (!walls) return;
  const v = lensVisuals(lens);
  applyWallGuides(series, callGuideRefs, walls.callWalls, v.callColor, v.callLabel);
  applyWallGuides(series, putGuideRefs, walls.putWalls, v.putColor, v.putLabel);
}

function applyStrikeTrails(
  chart: IChartApi,
  candleSeries: ISeriesApi<"Candlestick">,
  seriesByStrike: Map<number, ISeriesApi<"Line">>,
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  baseColor: string,
  lens: VectorWallLens
): void {
  const trails = trailsByStrike(history, side, lens);
  const active = new Set(pickActiveStrikes(trails));

  for (const [strike, trailSeries] of seriesByStrike) {
    if (!active.has(strike)) {
      chart.removeSeries(trailSeries);
      seriesByStrike.delete(strike);
    }
  }

  for (const strike of active) {
    const points = trails.get(strike)!;
    let trailSeries = seriesByStrike.get(strike);
    if (!trailSeries) {
      trailSeries = chart.addSeries(LineSeries, {
        color: baseColor,
        lineVisible: false,
        pointMarkersVisible: true,
        pointMarkersRadius: radiusForPct(0),
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      trailSeries.setSeriesOrder(0);
      seriesByStrike.set(strike, trailSeries);
    }
    const data: LineData<UTCTimestamp>[] = points.map((p) => ({
      time: p.time as UTCTimestamp,
      value: strike,
      color: withAlpha(baseColor, alphaForPct(p.pct)),
    }));
    trailSeries.setData(data);
    const latestPct = points[points.length - 1]?.pct ?? 0;
    trailSeries.applyOptions({ pointMarkersRadius: radiusForPct(latestPct) });
  }
  pinCandlesOnTop(candleSeries);
}

function applyFlipTrail(
  chart: IChartApi,
  candleSeries: ISeriesApi<"Candlestick">,
  flipSeriesRef: React.MutableRefObject<ISeriesApi<"Line"> | null>
): void {
  // Flip is axis-label only — no bead trail across the chart pane.
  if (flipSeriesRef.current) {
    chart.removeSeries(flipSeriesRef.current);
    flipSeriesRef.current = null;
  }
  pinCandlesOnTop(candleSeries);
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
  return Array.from({ length: MAX_WALL_GUIDES }, () => null);
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const callGuideRefs = useRef<(IPriceLine | null)[]>(emptyGuideRefs());
  const putGuideRefs = useRef<(IPriceLine | null)[]>(emptyGuideRefs());
  const dpGuideRefs = useRef<(IPriceLine | null)[]>([]);
  const flipGuideRef = useRef<IPriceLine | null>(null);
  const callStrikeSeriesRef = useRef(new Map<number, ISeriesApi<"Line">>());
  const putStrikeSeriesRef = useRef(new Map<number, ISeriesApi<"Line">>());
  const flipTrailSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
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
  const lensRef = useRef<VectorWallLens>("gex");
  const spotRef = useRef<number | null>(
    initialBars.length ? initialBars[initialBars.length - 1]!.close : null
  );
  const timelineRef = useRef<number[]>([]);
  const connRef = useRef<ReturnType<typeof createVectorEventSource> | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayModeRef = useRef(false);
  const liveSessionRef = useRef(liveSession);

  const [sessionHistory, setSessionHistory] = useState(initialWallHistory);
  const [sessionBars, setSessionBars] = useState(initialBars);
  const [replayMode, setReplayMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [crosshair, setCrosshair] = useState<VectorCrosshairState | null>(null);
  const [lens, setLens] = useState<VectorWallLens>("gex");
  const [wallEvents, setWallEvents] = useState<VectorWallEvent[]>(() => [
    ...eventsFromWallHistory(initialWallHistory, "gex"),
    ...eventsFromWallHistory(initialWallHistory, "vex"),
  ]);
  const [vexAvailable, setVexAvailable] = useState(
    () =>
      Boolean(initialVexWalls?.callWalls?.length || initialVexWalls?.putWalls?.length) ||
      hasVexInHistory(initialWallHistory)
  );
  const [gexAsOf, setGexAsOf] = useState<number | null>(null);
  const [vexAsOf, setVexAsOf] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<VectorTimeframeMinutes>(1);

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

  const refreshTrails = useCallback((activeLens: VectorWallLens) => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const v = lensVisuals(activeLens);
    const history =
      liveSessionRef.current && !replayModeRef.current
        ? trimHistoryForLiveTrails(
            wallHistoryRef.current,
            undefined,
            liveTrailAnchorSec(wallHistoryRef.current, minuteBarsRef.current.map((b) => b.time))
          )
        : wallHistoryRef.current;
    applyStrikeTrails(chart, series, callStrikeSeriesRef.current, history, "callWalls", v.callColor, activeLens);
    applyStrikeTrails(chart, series, putStrikeSeriesRef.current, history, "putWalls", v.putColor, activeLens);
    applyFlipTrail(chart, series, flipTrailSeriesRef);
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
      applyWallsToSeries(series, callGuideRefs, putGuideRefs, walls ?? undefined, activeLens);
      applyFlipGuide(series, flipGuideRef, flip, v.flipLabel, v.flipColor);
      applyDarkPoolGuides(series, dpGuideRefs, dp);
    },
    []
  );

  const applyFrame = useCallback(
    (cursorTime: number, bars: VectorBar[], history: WallHistorySample[], activeLens: VectorWallLens) => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;

      const visibleBars = displayBarsFromMinute(bars, timeframeRef.current, cursorTime);
      series.setData(visibleBars);

      const visibleHistory = sliceHistoryToTime(history, cursorTime);
      const v = lensVisuals(activeLens);
      applyStrikeTrails(chart, series, callStrikeSeriesRef.current, visibleHistory, "callWalls", v.callColor, activeLens);
      applyStrikeTrails(chart, series, putStrikeSeriesRef.current, visibleHistory, "putWalls", v.putColor, activeLens);
      applyFlipTrail(chart, series, flipTrailSeriesRef);

      const gexAt = wallsAtReplayTime(history, cursorTime, "gex") ?? initialWalls;
      const vexAt = wallsAtReplayTime(history, cursorTime, "vex") ?? initialVexWalls;
      const gammaAt = flipAtReplayTime(history, cursorTime, "gex") ?? initialGammaFlip;
      const vexFlipAt = flipAtReplayTime(history, cursorTime, "vex") ?? initialVexFlip;
      refreshOverlays(activeLens, gexAt, vexAt, gammaAt, vexFlipAt, darkPoolRef.current);
    },
    [initialWalls, initialVexWalls, initialGammaFlip, initialVexFlip, refreshOverlays]
  );

  const stopReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  const connectLive = useCallback(() => {
    if (!liveSessionRef.current) return;
    connRef.current?.close();

    let lastMinuteBarTime = minuteBarsRef.current.length
      ? minuteBarsRef.current[minuteBarsRef.current.length - 1]!.time
      : 0;
    let newBarOpened = false;

    connRef.current = createVectorEventSource((snap) => {
      if (replayModeRef.current) return;
      if (snap.sessionYmd && snap.sessionYmd !== sessionYmd) return;
      if (!liveSessionRef.current) return;

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
          refreshTrails(lensRef.current);
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
        newBarOpened = snap.candle.time > lastMinuteBarTime;
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
            snap.candle.time
          );
          if (spotEvents.length) {
            setWallEvents((ev) => appendVectorWallEvents(ev, spotEvents));
          }
        }
        spotRef.current = curSpot;
        minuteBarsRef.current = upsertBar(minuteBarsRef.current, snap.candle as VectorBar);
        setSessionBars(minuteBarsRef.current);
        const displayBars = displayBarsFromMinute(minuteBarsRef.current, timeframeRef.current);
        const lastDisplay = displayBars[displayBars.length - 1];
        if (lastDisplay) {
          const openedDisplayBar = lastDisplay.time > displayBarTimeRef.current;
          displayBarTimeRef.current = lastDisplay.time;
          seriesRef.current?.update(lastDisplay);
          if ((newBarOpened || openedDisplayBar) && chartRef.current) {
            chartRef.current.timeScale().scrollToRealTime();
          }
        }
      }

      refreshOverlays(
        lensRef.current,
        gexWallsRef.current,
        vexWallsRef.current,
        gammaFlipRef.current,
        vexFlipRef.current,
        darkPoolRef.current
      );
    });
  }, [sessionYmd, refreshTrails, refreshOverlays, onFreshness]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9fb4d4",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      timeScale: { timeVisible: true, secondsVisible: true },
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
    });

    series.setData(displayBarsFromMinute(initialBars, 1));
    displayBarTimeRef.current = initialBars[initialBars.length - 1]?.time ?? 0;
    if (initialBars.length) chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

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
      const walls = wallsForActiveLens(activeLens, gexWallsRef.current, vexWallsRef.current);
      setCrosshair({
        time,
        close: bar?.close ?? null,
        lens: activeLens,
        flip: flipForActiveLens(activeLens, gammaFlipRef.current, vexFlipRef.current),
        callWalls: walls?.callWalls ?? [],
        putWalls: walls?.putWalls ?? [],
        darkPoolLevels: darkPoolRef.current,
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
      callStrikeSeriesRef.current.clear();
      putStrikeSeriesRef.current.clear();
      flipTrailSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!replayMode || !playing || timelineRef.current.length === 0) {
      stopReplayTimer();
      return;
    }
    replayTimerRef.current = setInterval(() => {
      setCursorIndex((idx) => {
        const next = idx + 1;
        if (next >= timelineRef.current.length) {
          setPlaying(false);
          return idx;
        }
        const t = timelineRef.current[next]!;
        applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
        return next;
      });
    }, REPLAY_STEP_MS / Math.max(0.25, replaySpeed));

    return stopReplayTimer;
  }, [replayMode, playing, replaySpeed, applyFrame, stopReplayTimer]);

  const replayTimeline = buildReplayTimeline(sessionHistory, sessionBars);
  const canReplay = replayTimeline.length > 1;

  const enterReplay = () => {
    connRef.current?.close();
    connRef.current = null;
    timelineRef.current = replayTimeline;
    setReplayMode(true);
    setPlaying(false);
    setCursorIndex(0);
    if (replayTimeline.length > 0) {
      applyFrame(replayTimeline[0]!, minuteBarsRef.current, wallHistoryRef.current, lens);
    }
  };

  const exitReplay = () => {
    stopReplayTimer();
    setReplayMode(false);
    setPlaying(false);
    const bars = minuteBarsRef.current;
    const display = displayBarsFromMinute(bars, timeframeRef.current);
    displayBarTimeRef.current = display[display.length - 1]?.time ?? 0;
    seriesRef.current?.setData(display);
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
    connectLive();
  };

  const toggleReplay = () => {
    if (replayMode) exitReplay();
    else enterReplay();
  };

  const scrubTo = (index: number) => {
    setPlaying(false);
    setCursorIndex(index);
    const t = timelineRef.current[index];
    if (t != null) applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lens);
  };

  const stepCount = replayMode ? timelineRef.current.length : replayTimeline.length;
  const cursorTime = timelineRef.current[cursorIndex] ?? 0;
  const clockLabel = cursorTime ? formatReplayClock(cursorTime) : "—";

  useEffect(() => {
    if (replayMode) return;
    refreshTrails(lens);
    refreshOverlays(
      lens,
      gexWallsRef.current,
      vexWallsRef.current,
      gammaFlipRef.current,
      vexFlipRef.current,
      darkPoolRef.current
    );
  }, [lens, replayMode, refreshTrails, refreshOverlays]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series) return;
    const display = displayBarsFromMinute(minuteBarsRef.current, timeframe);
    displayBarTimeRef.current = display[display.length - 1]?.time ?? 0;
    series.setData(display);
    chart?.timeScale().applyOptions({ secondsVisible: timeframe === 1 });
    if (!replayMode && liveSession) {
      chart?.timeScale().scrollToRealTime();
    }
  }, [timeframe, replayMode, liveSession]);

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

      <VectorTimeframeToggle
        interval={timeframe}
        onInterval={setTimeframe}
        disabled={replayMode}
      />

      <VectorLensToggle
        lens={lens}
        vexAvailable={vexAvailable}
        onLens={handleLens}
        gexAsOf={gexAsOf}
        vexAsOf={vexAsOf}
        liveSession={liveSession && !replayMode}
      />

      <VectorWallEventTicker events={wallEvents} lens={lens} />

      <VectorReplayControls
        lens={lens}
        replayMode={replayMode}
        playing={playing}
        canReplay={canReplay}
        cursorIndex={cursorIndex}
        stepCount={stepCount}
        clockLabel={clockLabel}
        speed={replaySpeed}
        onToggleReplay={toggleReplay}
        onTogglePlay={() => setPlaying((p) => !p)}
        onScrub={scrubTo}
        onSpeed={setReplaySpeed}
      />

      <div className="relative">
        <VectorCrosshairLegend state={crosshair} />
        <div
          ref={containerRef}
          className="vector-chart-canvas"
          style={{ height: "calc(100vh - 320px)", minHeight: 440 }}
          aria-busy={liveSession && !replayMode}
        />
      </div>
    </div>
  );
}
