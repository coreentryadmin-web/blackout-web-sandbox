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
import { alphaForPct, radiusForPct, widthForPct } from "@/lib/providers/vector-wall-visual";
import {
  mergeWallHistory,
  pickActiveStrikes,
  recordWallSample,
  trailsByStrike,
  type WallHistorySample,
} from "@/lib/providers/vector-wall-history";

export type VectorBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

// Yellow call / purple put — same convention as the reference product screenshot.
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

/** Faint dashed guide for the current #1 wall only — beads carry the visual weight. */
function applyTopWallGuide(
  series: ISeriesApi<"Candlestick">,
  lineRef: React.MutableRefObject<IPriceLine | null>,
  level: VectorWallLevel | undefined,
  baseColor: string,
  label: string
): void {
  if (!level) {
    if (lineRef.current) {
      series.removePriceLine(lineRef.current);
      lineRef.current = null;
    }
    return;
  }
  const title = `${label} ${Math.round(level.strike)} — ${level.pct.toFixed(0)}%`;
  const color = withAlpha(baseColor, alphaForPct(level.pct) * 0.35);
  const lineWidth = widthForPct(level.pct);
  if (lineRef.current) {
    lineRef.current.applyOptions({
      price: level.strike,
      title,
      color,
      lineWidth,
      lineStyle: LineStyle.Dashed,
    });
  } else {
    lineRef.current = series.createPriceLine({
      price: level.strike,
      color,
      lineWidth,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title,
    });
  }
}

function applyWallsToSeries(
  series: ISeriesApi<"Candlestick">,
  callGuideRef: React.MutableRefObject<IPriceLine | null>,
  putGuideRef: React.MutableRefObject<IPriceLine | null>,
  walls: VectorWalls | null | undefined
): void {
  if (!walls) return;
  applyTopWallGuide(series, callGuideRef, walls.callWalls[0], CALL_WALL_COLOR, "Call wall");
  applyTopWallGuide(series, putGuideRef, walls.putWalls[0], PUT_WALL_COLOR, "Put wall");
}

/**
 * Strike-keyed bead rows — each price level gets a horizontal dot trail across the bars it
 * was active, matching the reference product (walls migrate as new rows, not diagonal rank lines).
 */
function applyStrikeTrails(
  chart: IChartApi,
  seriesByStrike: Map<number, ISeriesApi<"Line">>,
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  baseColor: string
): void {
  const trails = trailsByStrike(history, side);
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
}

export function VectorChart({ initialBars, initialWalls, initialWallHistory, liveSession }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const callGuideRef = useRef<IPriceLine | null>(null);
  const putGuideRef = useRef<IPriceLine | null>(null);
  const callStrikeSeriesRef = useRef(new Map<number, ISeriesApi<"Line">>());
  const putStrikeSeriesRef = useRef(new Map<number, ISeriesApi<"Line">>());
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
    applyWallsToSeries(series, callGuideRef, putGuideRef, initialWalls);

    const refreshWallTrails = () => {
      applyStrikeTrails(chart, callStrikeSeriesRef.current, wallHistoryRef.current, "callWalls", CALL_WALL_COLOR);
      applyStrikeTrails(chart, putStrikeSeriesRef.current, wallHistoryRef.current, "putWalls", PUT_WALL_COLOR);
    };
    refreshWallTrails();

    chartRef.current = chart;
    seriesRef.current = series;

    let lastBarTime = initialBars.length ? initialBars[initialBars.length - 1].time : 0;

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
        applyWallsToSeries(seriesRef.current, callGuideRef, putGuideRef, snap.walls);
      }
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
      callGuideRef.current = null;
      putGuideRef.current = null;
      callStrikeSeriesRef.current.clear();
      putStrikeSeriesRef.current.clear();
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
