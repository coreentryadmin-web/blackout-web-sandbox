"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { createVectorEventSource, type VectorWallLevel } from "@/lib/api";

export type VectorBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Props = {
  initialBars: VectorBar[];
};

// Purple = put wall (support), yellow = call wall (resistance) — matches the reference
// competitor product's color convention, confirmed against a user-provided screenshot.
const PUT_WALL_COLOR = "#b26bff";
const CALL_WALL_COLOR = "#ffd60a";

/** Create/update/remove a persistent gamma-wall price line in place, rather than tearing down
 *  and recreating it every tick — a wall shifts strikes far less often than the 1s poll cadence,
 *  so this avoids a visible flicker on every tick where the wall hasn't actually moved. */
function applyWallLine(
  series: ISeriesApi<"Candlestick">,
  ref: React.MutableRefObject<IPriceLine | null>,
  level: VectorWallLevel | null | undefined,
  color: string,
  label: string
): void {
  if (!level) {
    if (ref.current) {
      series.removePriceLine(ref.current);
      ref.current = null;
    }
    return;
  }
  const title = `${label} ${Math.round(level.strike)} — ${level.pct.toFixed(0)}%`;
  if (ref.current) {
    ref.current.applyOptions({ price: level.strike, title });
  } else {
    ref.current = series.createPriceLine({
      price: level.strike,
      color,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title,
    });
  }
}

/**
 * Phase A seeded a static chart from `initialBars`. Phase B added the live layer: an SSE
 * subscription (createVectorEventSource) pushes the currently-forming 1-minute bar roughly
 * once a second, and `series.update()` either refreshes that bar in place or appends a new
 * one — lightweight-charts' own semantics for "same time as last bar => update, later time
 * => append" do the bar-rollover handling for us, so no client-side bar-boundary logic needed.
 * Phase C adds the dealer gamma-wall overlay: put wall (support) and call wall (resistance)
 * rendered as persistent horizontal price lines that reposition/relabel as the wall shifts.
 */
export function VectorChart({ initialBars }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const callWallLineRef = useRef<IPriceLine | null>(null);
  const putWallLineRef = useRef<IPriceLine | null>(null);

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
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

    // lightweight-charts rejects an update() older than the series' last bar — guard against a
    // stale/duplicate SSE tick (or one racing the REST-seeded initialBars) ever throwing.
    let lastBarTime = initialBars.length ? initialBars[initialBars.length - 1].time : 0;
    const conn = createVectorEventSource((snap) => {
      if (!snap.candle || snap.candle.time < lastBarTime) return;
      lastBarTime = snap.candle.time;
      seriesRef.current?.update(snap.candle as VectorBar);
      if (seriesRef.current) {
        applyWallLine(seriesRef.current, callWallLineRef, snap.walls?.callWall, CALL_WALL_COLOR, "Call wall");
        applyWallLine(seriesRef.current, putWallLineRef, snap.walls?.putWall, PUT_WALL_COLOR, "Put wall");
      }
    });

    return () => {
      conn?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      callWallLineRef.current = null;
      putWallLineRef.current = null;
    };
    // initialBars is only the seed for this mount — live updates land via seriesRef, not by
    // re-seeding/resubscribing on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="vector-chart-canvas" style={{ height: "calc(100vh - 280px)", minHeight: 480 }} />;
}
