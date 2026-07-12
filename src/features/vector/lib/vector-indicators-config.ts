/**
 * Registry of the price-pane overlay indicators the member can toggle on the Vector chart
 * (default OFF — nothing is drawn until enabled). Each entry is pure config; the chart layer maps
 * `kind`+`period` to the matching `vector-indicators` series computer and draws a line in `color`.
 * Kept as data (not hard-coded in the component) so adding an overlay is a one-line change and the
 * toggle menu renders straight from this list.
 *
 * Two layers on purpose:
 *  - `VECTOR_OVERLAYS` — the concrete LINES the chart actually draws (EMA 9, EMA 21, …). Each line
 *    still gets its own series + colour.
 *  - `VECTOR_OVERLAY_FAMILIES` — the TOGGLE units the member sees. One toggle per TYPE (VWAP / EMA /
 *    SMA), so enabling "EMA" draws every EMA line at once instead of three separate checkboxes. The
 *    enabled Set holds family ids, and the chart draws a line iff its `family` is enabled. New types
 *    (DMA, volume/session profile, …) slot in as one more family with its member lines.
 */

export type VectorOverlayId = "vwap" | "ema9" | "ema21" | "ema50" | "sma50" | "sma200";

/** Overlay TYPE — the toggle unit. One family expands to all its member lines. */
export type VectorOverlayFamilyId = "vwap" | "ema" | "sma";

export type VectorOverlayDef = {
  id: VectorOverlayId;
  label: string;
  /** Which `vector-indicators` computer feeds this line. */
  kind: "vwap" | "ema" | "sma";
  /** Which toggle family this line belongs to — the chart draws it iff the family is enabled. */
  family: VectorOverlayFamilyId;
  /** Lookback for ema/sma; unused for vwap. */
  period?: number;
  /** Line colour — chosen distinct from the gold/purple beads and the cyan gamma-flip line. */
  color: string;
};

export const VECTOR_OVERLAYS: readonly VectorOverlayDef[] = [
  { id: "vwap", label: "VWAP", kind: "vwap", family: "vwap", color: "#60a5fa" },
  { id: "ema9", label: "EMA 9", kind: "ema", family: "ema", period: 9, color: "#fb923c" },
  { id: "ema21", label: "EMA 21", kind: "ema", family: "ema", period: 21, color: "#fbbf24" },
  { id: "ema50", label: "EMA 50", kind: "ema", family: "ema", period: 50, color: "#f472b6" },
  { id: "sma50", label: "SMA 50", kind: "sma", family: "sma", period: 50, color: "#2dd4bf" },
  { id: "sma200", label: "SMA 200", kind: "sma", family: "sma", period: 200, color: "#f87171" },
] as const;

const OVERLAY_IDS = new Set<string>(VECTOR_OVERLAYS.map((o) => o.id));

export function isVectorOverlayId(v: unknown): v is VectorOverlayId {
  return typeof v === "string" && OVERLAY_IDS.has(v);
}

export type VectorOverlayFamilyDef = {
  id: VectorOverlayFamilyId;
  /** Menu label — includes the member periods so the member knows what "EMA" expands to. */
  label: string;
  /** Representative colour for the menu dot (each member line carries its own colour). */
  color: string;
  /** The concrete overlay lines this family draws when enabled (draw order preserved). */
  memberIds: readonly VectorOverlayId[];
};

/**
 * The moving-average TYPES the member toggles. Derived from `VECTOR_OVERLAYS` so the two can't
 * drift: members are every overlay sharing the family, in registry order; the representative colour
 * is the first member's. VWAP is a family of one — kept a family so the menu is uniform.
 */
export const VECTOR_OVERLAY_FAMILIES: readonly VectorOverlayFamilyDef[] = (() => {
  const order: VectorOverlayFamilyId[] = ["vwap", "ema", "sma"];
  const labels: Record<VectorOverlayFamilyId, string> = { vwap: "VWAP", ema: "EMA", sma: "SMA" };
  return order.map((fam) => {
    const members = VECTOR_OVERLAYS.filter((o) => o.family === fam);
    const periods = members.map((m) => m.period).filter((p): p is number => p != null);
    const label = periods.length ? `${labels[fam]} (${periods.join(" · ")})` : labels[fam];
    return { id: fam, label, color: members[0]!.color, memberIds: members.map((m) => m.id) };
  });
})();

const FAMILY_IDS = new Set<string>(VECTOR_OVERLAY_FAMILIES.map((f) => f.id));

export function isVectorOverlayFamilyId(v: unknown): v is VectorOverlayFamilyId {
  return typeof v === "string" && FAMILY_IDS.has(v);
}

/**
 * "Levels" indicators — horizontal price-line overlays (drawn like the king anchor, not per-bar
 * series). Each id maps to `levelLinesFor(id, bars)` in `vector-key-levels`, which yields one or
 * more lines. Same opt-in/default-off contract as the overlays. These are already one toggle per
 * type (HOD/LOD, opening range, …), so they need no family layer.
 */
export type VectorLevelId = "hod-lod" | "opening-range" | "fib" | "pdh-pdl-pdc" | "pivots";

export type VectorLevelDef = {
  id: VectorLevelId;
  label: string;
  /** Representative colour for the menu dot (the individual lines carry their own colours). */
  color: string;
  group: "Key levels";
  /** True when the level needs the prior-day OHLC fetch (PDH/PDL/PDC, pivots) rather than just the
   *  current session bars. The chart lazily fetches that once when any such level is enabled. */
  needsPriorDay?: boolean;
};

export const VECTOR_LEVELS: readonly VectorLevelDef[] = [
  { id: "hod-lod", label: "HOD / LOD", color: "#34d399", group: "Key levels" },
  { id: "opening-range", label: "Opening range (15m)", color: "#a78bfa", group: "Key levels" },
  { id: "fib", label: "Fibonacci (HOD→LOD)", color: "#ffd60a", group: "Key levels" },
  { id: "pdh-pdl-pdc", label: "PDH / PDL / PDC", color: "#38bdf8", group: "Key levels", needsPriorDay: true },
  { id: "pivots", label: "Floor pivots (P/R/S)", color: "#fb923c", group: "Key levels", needsPriorDay: true },
] as const;

const LEVEL_IDS = new Set<string>(VECTOR_LEVELS.map((l) => l.id));

export function isVectorLevelId(v: unknown): v is VectorLevelId {
  return typeof v === "string" && LEVEL_IDS.has(v);
}

/**
 * Every toggleable indicator id — a moving-average FAMILY (not an individual line) plus a level.
 * This is what the enabled Set and the menu deal in; the chart expands each family to its member
 * lines at draw time.
 */
export type VectorIndicatorId = VectorOverlayFamilyId | VectorLevelId;

/** Menu structure — the toggle menu renders straight from this (title + its items). */
export const VECTOR_INDICATOR_GROUPS: ReadonlyArray<{
  title: string;
  items: ReadonlyArray<{ id: VectorIndicatorId; label: string; color: string }>;
}> = [
  {
    title: "Moving averages",
    items: VECTOR_OVERLAY_FAMILIES.map((f) => ({ id: f.id, label: f.label, color: f.color })),
  },
  {
    title: "Key levels",
    items: VECTOR_LEVELS.map((l) => ({ id: l.id, label: l.label, color: l.color })),
  },
];
