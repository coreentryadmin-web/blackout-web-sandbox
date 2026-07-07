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

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Rank 0 (server-ranked strongest) renders at full color; each weaker rank fades, so the
// dominant wall per side reads clearly while the others stay visible as secondary context —
// same "hierarchy of nodes" idea as the reference product's multi-node display.
const RANK_ALPHA = [1, 0.65, 0.42, 0.28, 0.2];
function alphaForRank(rank: number): number {
  return RANK_ALPHA[rank] ?? RANK_ALPHA[RANK_ALPHA.length - 1];
}

/**
 * Reconcile a ranked array of wall levels (strongest-first, from the server) against a
 * persisted array of price-line refs for one side (call or put): updates a rank's line in
 * place where it still has a level (avoiding the flicker a full teardown/recreate would cause
 * on every ~1s tick), creates a new line for a rank that just gained a level, and removes a
 * rank's line once it no longer has one (e.g. the ladder thinned to fewer distinct strikes).
 */
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
    const color = withAlpha(baseColor, alphaForRank(i));
    if (lines[i]) {
      lines[i]!.applyOptions({ price: level.strike, title, color });
    } else {
      lines[i] = series.createPriceLine({
        price: level.strike,
        color,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title,
      });
    }
  }
  lines.length = list.length; // trailing slots beyond the new count were already removed above
}

/**
 * Phase A seeded a static chart from `initialBars`. Phase B added the live layer: an SSE
 * subscription (createVectorEventSource) pushes the currently-forming 1-minute bar roughly
 * once a second, and `series.update()` either refreshes that bar in place or appends a new
 * one — lightweight-charts' own semantics for "same time as last bar => update, later time
 * => append" do the bar-rollover handling for us, so no client-side bar-boundary logic needed.
 * Phase C adds the dealer gamma-wall overlay: put walls (support) and call walls (resistance),
 * each a ranked top-N list from the server, rendered as persistent horizontal price lines
 * (strongest per side at full color, weaker ranks fading) that reposition/relabel as they shift.
 */
export function VectorChart({ initialBars }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const callWallLinesRef = useRef<(IPriceLine | null)[]>([]);
  const putWallLinesRef = useRef<(IPriceLine | null)[]>([]);

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
        applyWallLines(seriesRef.current, callWallLinesRef, snap.walls?.callWalls, CALL_WALL_COLOR, "Call wall");
        applyWallLines(seriesRef.current, putWallLinesRef, snap.walls?.putWalls, PUT_WALL_COLOR, "Put wall");
      }
    });

    return () => {
      conn?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      callWallLinesRef.current = [];
      putWallLinesRef.current = [];
    };
    // initialBars is only the seed for this mount — live updates land via seriesRef, not by
    // re-seeding/resubscribing on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="vector-chart-canvas" style={{ height: "calc(100vh - 280px)", minHeight: 480 }} />;
}
