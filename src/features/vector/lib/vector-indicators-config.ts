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

/**
 * "Levels" indicators — horizontal price-line overlays (drawn like the king anchor, not per-bar
 * series). Each id maps to `levelLinesFor(id, bars)` in `vector-key-levels`, which yields one or
 * more lines. Same opt-in/default-off contract as the overlays.
 */
export type VectorLevelId = "hod-lod" | "opening-range" | "fib";

export type VectorLevelDef = {
  id: VectorLevelId;
  label: string;
  /** Representative colour for the menu dot (the individual lines carry their own colours). */
  color: string;
  group: "Key levels";
};

export const VECTOR_LEVELS: readonly VectorLevelDef[] = [
  { id: "hod-lod", label: "HOD / LOD", color: "#34d399", group: "Key levels" },
  { id: "opening-range", label: "Opening range (15m)", color: "#a78bfa", group: "Key levels" },
  { id: "fib", label: "Fibonacci (HOD→LOD)", color: "#ffd60a", group: "Key levels" },
] as const;

const LEVEL_IDS = new Set<string>(VECTOR_LEVELS.map((l) => l.id));

export function isVectorLevelId(v: unknown): v is VectorLevelId {
  return typeof v === "string" && LEVEL_IDS.has(v);
}

/** Every toggleable indicator id (overlays + levels). */
export type VectorIndicatorId = VectorOverlayId | VectorLevelId;

/** Menu structure — the toggle menu renders straight from this (title + its items). */
export const VECTOR_INDICATOR_GROUPS: ReadonlyArray<{
  title: string;
  items: ReadonlyArray<{ id: VectorIndicatorId; label: string; color: string }>;
}> = [
  {
    title: "Moving averages",
    items: VECTOR_OVERLAYS.map((o) => ({ id: o.id, label: o.label, color: o.color })),
  },
  {
    title: "Key levels",
    items: VECTOR_LEVELS.map((l) => ({ id: l.id, label: l.label, color: l.color })),
  },
];
