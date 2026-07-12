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
 * Whether a moving-average family can actually draw at the current bar count. `emaSeries`/`smaSeries`
 * produce their first value only once `period` bars exist (VWAP needs just one), so a higher
 * timeframe — where a 6.5h session is only a handful of bars — can leave SMA 200 permanently
 * un-computable. The menu uses this to annotate (and disable, when nothing at all draws) so an
 * enabled toggle that renders nothing is explained rather than looking broken.
 *
 * - `full`    — every member has enough bars.
 * - `partial` — some members draw, some don't (`missing` lists the periods that can't).
 * - `none`    — not even the shortest member can draw; `minBars` is how many it needs.
 */
export function overlayFamilyAvailability(
  familyId: VectorOverlayFamilyId,
  barCount: number
): { status: "full" | "partial" | "none"; minBars: number; missing: number[] } {
  const members = VECTOR_OVERLAYS.filter((o) => o.family === familyId);
  // Bars a member needs before its first point is defined: its lookback, or 1 for VWAP.
  const req = (o: VectorOverlayDef) => o.period ?? 1;
  const minBars = Math.min(...members.map(req));
  const missing = members.filter((o) => barCount < req(o)).map((o) => o.period ?? 1);
  const drawable = members.length - missing.length;
  const status = drawable === members.length ? "full" : drawable === 0 ? "none" : "partial";
  return { status, minBars, missing };
}

/**
 * "Levels" indicators — horizontal price-line overlays (drawn like the king anchor, not per-bar
 * series). Each id maps to `levelLinesFor(id, bars)` in `vector-key-levels`, which yields one or
 * more lines. Same opt-in/default-off contract as the overlays. These are already one toggle per
 * type (HOD/LOD, opening range, …), so they need no family layer.
 */
export type VectorLevelId = "hod-lod" | "opening-range" | "fib" | "fib-auto" | "pdh-pdl-pdc" | "pivots";

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
  { id: "fib-auto", label: "Auto fib + golden pocket", color: "#fde047", group: "Key levels" },
  { id: "pdh-pdl-pdc", label: "PDH / PDL / PDC", color: "#38bdf8", group: "Key levels", needsPriorDay: true },
  { id: "pivots", label: "Floor pivots (P/R/S)", color: "#fb923c", group: "Key levels", needsPriorDay: true },
] as const;

const LEVEL_IDS = new Set<string>(VECTOR_LEVELS.map((l) => l.id));

export function isVectorLevelId(v: unknown): v is VectorLevelId {
  return typeof v === "string" && LEVEL_IDS.has(v);
}

/**
 * "Structure" indicators — chart MARKERS (pivot labels + BOS/CHOCH flags), not lines or series.
 * One toggle; the chart maps it to a dedicated series-markers instance fed by
 * `buildStructureMarkers`. Same opt-in/default-off contract as everything else in the menu.
 */
export type VectorStructureId = "market-structure";

export function isVectorStructureId(v: unknown): v is VectorStructureId {
  return v === "market-structure";
}

/**
 * "Oscillators" — momentum studies drawn in their OWN sub-pane BELOW the price pane (not overlaid
 * on price, whose scale is unrelated). Each maps to a `vector-indicators` computer and a dedicated
 * lightweight-charts pane. RSI needs `period+1` bars, MACD needs the slow EMA's seed, so a coarse
 * timeframe with too few bars simply draws nothing (honest, like the levels).
 */
export type VectorOscillatorId = "rsi" | "macd";

export function isVectorOscillatorId(v: unknown): v is VectorOscillatorId {
  return v === "rsi" || v === "macd";
}

/**
 * Every toggleable indicator id — a moving-average FAMILY (not an individual line), a level, a
 * structure toggle, or an oscillator. This is what the enabled Set and the menu deal in; the chart
 * expands each to its lines/markers/panes at draw time.
 */
export type VectorIndicatorId =
  | VectorOverlayFamilyId
  | VectorLevelId
  | VectorStructureId
  | VectorOscillatorId;

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
  {
    title: "Structure",
    items: [{ id: "market-structure", label: "Market structure (HH/HL · BOS/CHOCH)", color: "#22d3ee" }],
  },
  {
    title: "Oscillators",
    items: [
      { id: "rsi", label: "RSI (14)", color: "#c084fc" },
      { id: "macd", label: "MACD (12/26/9)", color: "#38bdf8" },
    ],
  },
];
