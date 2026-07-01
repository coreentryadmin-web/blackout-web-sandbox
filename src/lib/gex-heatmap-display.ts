/** Shared GEX heatmap cell formatting + color scale (Thermal + SPX Slayer matrix). */

import type { CSSProperties } from "react";

/** SPX Slayer matrix uses gex/vex; Thermal adds dex/charm on the same cell scale. */
export type GexHeatmapLens = "gex" | "vex" | "dex" | "charm";

const LENS_COLORS: Record<GexHeatmapLens, { posRgb: string; negRgb: string }> = {
  gex: { posRgb: "0, 230, 118", negRgb: "255, 45, 85" },
  vex: { posRgb: "125, 211, 252", negRgb: "255, 45, 85" },
  dex: { posRgb: "34, 211, 238", negRgb: "255, 45, 85" },
  charm: { posRgb: "255, 210, 63", negRgb: "255, 45, 85" },
};

/** Compact unsigned dollar: $22.1K / -$45.2M */
export function fmtHeatmapMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs < 1) return "$0.0K";
  return `${sign}$${abs.toFixed(0)}`;
}

/** Signed cell value — competitor-style shows $0.0K at zero when showZero is true. */
export function fmtHeatmapMoneySigned(n: number, opts?: { showZero?: boolean }): string {
  if (n === 0) return opts?.showZero ? "$0.0K" : "·";
  return n > 0 ? `+${fmtHeatmapMoney(n)}` : fmtHeatmapMoney(n);
}

export function heatmapCellStyle(
  value: number,
  peak: number,
  lens: GexHeatmapLens
): CSSProperties {
  if (!value || peak <= 0) return {};
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = 0.04 + Math.pow(mag, 1.35) * 0.88;
  const c = LENS_COLORS[lens];
  const rgb = value > 0 ? c.posRgb : c.negRgb;
  return {
    backgroundColor: `rgba(${rgb},${alpha.toFixed(3)})`,
    boxShadow: mag > 0.45 ? `inset 0 0 18px rgba(${rgb},${(mag * 0.4).toFixed(2)})` : undefined,
  };
}

export function heatmapCellTextStyle(value: number, peak: number): CSSProperties {
  if (!value || peak <= 0) return {};
  const mag = Math.min(1, Math.abs(value) / peak);
  if (mag > 0.45) return { color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.55)" };
  return { textShadow: "0 1px 2px rgba(0,0,0,0.72)" };
}

export function fmtHeatmapExpiry(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

export function fmtHeatmapStrike(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}
