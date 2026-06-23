/**
 * Shared brand chart theme — the single source of truth for chart colors so
 * recharts / TradingView surfaces stay on-brand (emerald/bear/sky, no grey).
 *
 * up    — bullish / growing series        (#00e676, brand bull)
 * down  — bearish / falling series        (#ff2d55, brand bear)
 * axis  — axis labels / tick text         (sky-300)
 * grid  — grid lines (faint emerald)      (rgba bull 0.08)
 * text  — generic chart text              (sky-300)
 */
export const CHART_THEME = {
  up: "#00e676",
  down: "#ff2d55",
  axis: "#7dd3fc",
  grid: "rgba(0,230,118,0.08)",
  text: "#7dd3fc",
} as const;

export type ChartTheme = typeof CHART_THEME;

/** Recharts-shaped helpers (tick fills, grid stroke, tooltip chrome). */
export const rechartsTheme = {
  axisTick: { fill: CHART_THEME.axis, fontSize: 11, fontFamily: "monospace" },
  gridStroke: CHART_THEME.grid,
  tooltip: {
    background: "#0a0a0a",
    border: `1px solid ${CHART_THEME.up}`,
    fontFamily: "monospace",
    fontSize: 11,
  },
} as const;

/** TradingView embed-config color tokens (rgba strings the widget expects). */
export const tradingViewTheme = {
  plotLineColorGrowing: "rgba(0,230,118,1)",
  plotLineColorFalling: "rgba(255,45,85,1)",
  gridLineColor: "rgba(0,230,118,0.08)",
  scaleFontColor: "rgba(125,211,252,1)",
  belowLineFillColorGrowing: "rgba(0,230,118,0.12)",
  belowLineFillColorFalling: "rgba(255,45,85,0.12)",
  belowLineFillColorGrowingBottom: "rgba(0,230,118,0)",
  belowLineFillColorFallingBottom: "rgba(255,45,85,0)",
  symbolActiveColor: "rgba(0,230,118,0.12)",
} as const;
