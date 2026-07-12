/**
 * Registry of the price-pane overlay indicators the member can toggle on the Vector chart
 * (default OFF — nothing is drawn until enabled). Each entry is pure config; the chart layer maps
 * `kind`+`period` to the matching `vector-indicators` series computer and draws a line in `color`.
 * Kept as data (not hard-coded in the component) so adding an overlay is a one-line change and the
 * toggle menu renders straight from this list.
 */

export type VectorOverlayId = "vwap" | "ema9" | "ema21" | "ema50" | "sma50" | "sma200";

export type VectorOverlayDef = {
  id: VectorOverlayId;
  label: string;
  /** Which `vector-indicators` computer feeds this line. */
  kind: "vwap" | "ema" | "sma";
  /** Lookback for ema/sma; unused for vwap. */
  period?: number;
  /** Line colour — chosen distinct from the gold/purple beads and the cyan gamma-flip line. */
  color: string;
  /** Menu grouping. */
  group: "Moving averages";
};

export const VECTOR_OVERLAYS: readonly VectorOverlayDef[] = [
  { id: "vwap", label: "VWAP", kind: "vwap", color: "#60a5fa", group: "Moving averages" },
  { id: "ema9", label: "EMA 9", kind: "ema", period: 9, color: "#fb923c", group: "Moving averages" },
  { id: "ema21", label: "EMA 21", kind: "ema", period: 21, color: "#fbbf24", group: "Moving averages" },
  { id: "ema50", label: "EMA 50", kind: "ema", period: 50, color: "#f472b6", group: "Moving averages" },
  { id: "sma50", label: "SMA 50", kind: "sma", period: 50, color: "#2dd4bf", group: "Moving averages" },
  { id: "sma200", label: "SMA 200", kind: "sma", period: 200, color: "#f87171", group: "Moving averages" },
] as const;

const OVERLAY_IDS = new Set<string>(VECTOR_OVERLAYS.map((o) => o.id));

export function isVectorOverlayId(v: unknown): v is VectorOverlayId {
  return typeof v === "string" && OVERLAY_IDS.has(v);
}
