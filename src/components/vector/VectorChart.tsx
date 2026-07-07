"use client";

import { useEffect, useRef } from "react";
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
import { createVectorEventSource, type VectorWallLevel, type VectorWalls } from "@/lib/api";
import { DEFAULT_WALL_NODES_PER_SIDE } from "@/lib/providers/gex-wall-levels";
import { alphaForPct, radiusForPct, widthForPct } from "@/lib/providers/vector-wall-visual";
import {
  mergeWallHistory,
  recordWallSample,
  trailForRank,
  type WallHistorySample,
} from "@/lib/providers/vector-wall-history";

export type VectorBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

// Purple = put wall (support), yellow = call wall (resistance) — matches the reference
// competitor product's color convention, confirmed against a user-provided screenshot.
const PUT_WALL_COLOR = "#b26bff";
const CALL_WALL_COLOR = "#ffd60a";

type Props = {
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  liveSession: boolean;
};

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyWallLines(
  series: ISeriesApi<"Candlestick">,
  linesRef: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: VectorWallLevel[] | undefined,
  baseColor: string,
  label: string
): void {
  const list = levels ?? [];
  const lines = linesRef.current;
  const max = Math.max(list.length, lines.length);
  for (let i = 0; i < max; i++) {
    const level = list[i];
    if (!level) {
      if (lines[i]) {
        series.removePriceLine(lines[i]!);
        lines[i] = null;
      }
      continue;
    }
    const title = `${label} ${Math.round(level.strike)} — ${level.pct.toFixed(0)}%`;
    const color = withAlpha(baseColor, alphaForPct(level.pct));
    const lineWidth = widthForPct(level.pct);
    if (lines[i]) {
      lines[i]!.applyOptions({ price: level.strike, title, color, lineWidth });
    } else {
      lines[i] = series.createPriceLine({
        price: level.strike,
        color,
        lineWidth,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title,
      });
    }
  }
  lines.length = list.length;
}

function applyWallsToSeries(
  series: ISeriesApi<"Candlestick">,
  callWallLinesRef: React.MutableRefObject<(IPriceLine | null)[]>,
  putWallLinesRef: React.MutableRefObject<(IPriceLine | null)[]>,
  walls: VectorWalls | null | undefined
): void {
  if (!walls) return;
  applyWallLines(series, callWallLinesRef, walls.callWalls, CALL_WALL_COLOR, "Call wall");
  applyWallLines(series, putWallLinesRef, walls.putWalls, PUT_WALL_COLOR, "Put wall");
}

/**
 * The historical dot trail per wall rank/side — a record of where that rank actually sat over
 * time (see vector-wall-history.ts), rendered as a dot-only LineSeries (no connecting stroke) so
 * it reads as a beaded trail rather than a jagged diagonal line between price levels, matching
 * the reference product's look. Each point's color carries its OWN pct-derived opacity (per-point
 * `color` on LineData), so a historical dot's intensity reflects how big the wall was AT THAT
 * TIME — the series-level `pointMarkersRadius` can only reflect the CURRENT rank's magnitude
 * (lightweight-charts has no per-point radius), so thickness is a coarser, present-tense signal
 * layered on top of the per-point color history.
 */
function applyWallTrail(
  seriesRefs: (ISeriesApi<"Line"> | null)[],
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  baseColor: string
): void {
  for (let rank = 0; rank < seriesRefs.length; rank++) {
    const trailSeries = seriesRefs[rank];
    if (!trailSeries) continue;
    const points = trailForRank(history, side, rank);
    const data: LineData<UTCTimestamp>[] = points.map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.strike,
      color: withAlpha(baseColor, alphaForPct(p.pct)),
    }));
    trailSeries.setData(data);
    const latestPct = points.length ? points[points.length - 1].pct : 0;
    trailSeries.applyOptions({ pointMarkersRadius: radiusForPct(latestPct) });
  }
}

function createWallTrailSeries(chart: IChartApi, baseColor: string): ISeriesApi<"Line">[] {
  return Array.from({ length: DEFAULT_WALL_NODES_PER_SIDE }, () =>
    chart.addSeries(LineSeries, {
      color: baseColor,
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: radiusForPct(0),
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
  );
}

export function VectorChart({ initialBars, initialWalls, initialWallHistory, liveSession }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const callWallLinesRef = useRef<(IPriceLine | null)[]>([]);
  const putWallLinesRef = useRef<(IPriceLine | null)[]>([]);
  const callTrailSeriesRef = useRef<(ISeriesApi<"Line"> | null)[]>([]);
  const putTrailSeriesRef = useRef<(ISeriesApi<"Line"> | null)[]>([]);
  const wallHistoryRef = useRef<WallHistorySample[]>(initialWallHistory);

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
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#00e676",
      downColor: "#ff2d55",
      borderVisible: false,
      wickUpColor: "#00e676",
      wickDownColor: "#ff2d55",
    });
    series.setData(initialBars);
    if (initialBars.length) chart.timeScale().fitContent();
    applyWallsToSeries(series, callWallLinesRef, putWallLinesRef, initialWalls);

    callTrailSeriesRef.current = createWallTrailSeries(chart, CALL_WALL_COLOR);
    putTrailSeriesRef.current = createWallTrailSeries(chart, PUT_WALL_COLOR);
    applyWallTrail(callTrailSeriesRef.current, wallHistoryRef.current, "callWalls", CALL_WALL_COLOR);
    applyWallTrail(putTrailSeriesRef.current, wallHistoryRef.current, "putWalls", PUT_WALL_COLOR);

    chartRef.current = chart;
    seriesRef.current = series;

    let lastBarTime = initialBars.length ? initialBars[initialBars.length - 1].time : 0;
    const refreshWallTrails = () => {
      applyWallTrail(callTrailSeriesRef.current, wallHistoryRef.current, "callWalls", CALL_WALL_COLOR);
      applyWallTrail(putTrailSeriesRef.current, wallHistoryRef.current, "putWalls", PUT_WALL_COLOR);
    };

    const conn = createVectorEventSource((snap) => {
      if (snap.wallHistory?.length) {
        const merged = mergeWallHistory(wallHistoryRef.current, snap.wallHistory);
        if (merged !== wallHistoryRef.current) {
          wallHistoryRef.current = merged;
          refreshWallTrails();
        }
      }
      if (snap.candle && snap.candle.time >= lastBarTime) {
        lastBarTime = snap.candle.time;
        seriesRef.current?.update(snap.candle as VectorBar);
      }
      if (seriesRef.current && snap.walls) {
        applyWallsToSeries(seriesRef.current, callWallLinesRef, putWallLinesRef, snap.walls);
      }
      // The trail is keyed by the candle's own bar time, so it only advances on a real price
      // tick — off-hours (candle null) the wall can still update the current-level price lines
      // above, but there's no bar to hang a new trail point on.
      if (snap.candle && snap.walls) {
        wallHistoryRef.current = recordWallSample(wallHistoryRef.current, {
          time: snap.candle.time,
          walls: snap.walls,
        });
        refreshWallTrails();
      }
    });

    return () => {
      conn?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      callWallLinesRef.current = [];
      putWallLinesRef.current = [];
      callTrailSeriesRef.current = [];
      putTrailSeriesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="vector-chart-wrap">
      {!initialBars.length && (
        <p className="mb-3 font-mono text-xs text-sky-300">
          No SPX session bars available yet — gamma walls will still load when data is present.
        </p>
      )}
      <div
        ref={containerRef}
        className="vector-chart-canvas"
        style={{ height: "calc(100vh - 280px)", minHeight: 480 }}
        aria-busy={liveSession}
      />
    </div>
  );
}
