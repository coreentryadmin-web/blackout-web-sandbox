/**
 * Options-flow markers for the Vector price chart (feature #20) — pure, isomorphic mapping from a
 * list of large option prints to lightweight-charts marker descriptors, plus the large-trade filter
 * and the top-N display cap. NO server-only / provider imports here so BOTH the server route (which
 * filters + caps the real Massive/Polygon prints) and the client chart (which builds the markers)
 * import the SAME logic — the filter/cap can never drift between the two, and every rule is unit
 * tested directly.
 *
 * A "print" is one executed option trade near the money: its STRIKE places it on the price axis, its
 * TIMESTAMP on the time axis, so the member sees where big money actually hit relative to the candles
 * and the gamma walls. `side` is the contract type (call/put); `aggressor` (when a contemporaneous
 * NBBO let us classify it) says whether it lifted the offer (buy) or hit the bid (sell).
 */

import { fmtPremium } from "@/lib/fmt-money";

/** One large option print surfaced to the chart. `tsMs` is epoch milliseconds (SIP time). */
export type FlowPrint = {
  strike: number;
  side: "call" | "put";
  /** price × size × 100 — real dollars. */
  premium: number;
  /** contracts. */
  size: number;
  tsMs: number;
  /** Quote-rule classification vs the contract's NBBO at discovery; null when unclassifiable. */
  aggressor?: "buy" | "sell" | null;
};

/**
 * Flow-marker colours. Deliberately the SAME green/red the market-structure markers and the volume
 * histogram already use (call = green #34d399, put = red #f87171), NOT the gold/purple wall-bead
 * tokens — so flow prints read as their own layer and never visually merge with the gamma-wall beads
 * sitting at the same strikes. Reused (not re-picked) so the call/put convention stays one system.
 */
export const FLOW_CALL_COLOR = "#34d399"; // green — call print (matches structure HH/HL + volume-up)
export const FLOW_PUT_COLOR = "#f87171"; // red — put print (matches structure LH/LL + volume-down)

/**
 * Default LARGE-trade premium floor. A single near-ATM print of ≥ $250K premium is a genuinely
 * notable institutional-size options bet — big enough that a member cares WHERE it hit, but not so
 * low that ordinary retail lots flood the chart (0DTE ATM contracts print thousands of small fills a
 * minute). Env-tunable server-side; exported so the test and the server share the one number.
 */
export const DEFAULT_FLOW_MIN_PREMIUM = 250_000;

/** Default cap on how many prints the chart draws — top N by premium. Keeps the chart readable. */
export const DEFAULT_FLOW_MAX_MARKERS = 40;

export type FlowFilterOpts = {
  /** Keep prints with premium ≥ this (dollars). */
  minPremium: number;
  /** When both provided, keep only prints whose strike is within `spot × bandPct` of spot. */
  spot?: number | null;
  bandPct?: number;
};

/**
 * Keep only the LARGE prints (premium ≥ minPremium) and, when a spot + band are given, only those
 * near the visible strike band. Pure — the server bands its chain fetch already, but running the band
 * here too keeps the rule explicit and testable and guards a caller that passes raw prints.
 */
export function filterLargeFlowPrints(prints: readonly FlowPrint[], opts: FlowFilterOpts): FlowPrint[] {
  const { minPremium, spot, bandPct } = opts;
  const band = spot != null && spot > 0 && bandPct != null && bandPct > 0 ? spot * bandPct : null;
  return prints.filter((p) => {
    if (!(Number.isFinite(p.premium) && p.premium >= minPremium)) return false;
    if (!Number.isFinite(p.strike) || p.strike <= 0) return false;
    if (band != null && Math.abs(p.strike - (spot as number)) > band) return false;
    return true;
  });
}

/**
 * Top-N-by-premium display cap. Returns the kept prints (largest premium first) and how many were
 * dropped, so the caller can ANNOUNCE the truncation (no silent drop — see the console note the chart
 * logs). maxN ≤ 0 means "no cap".
 */
export function capFlowMarkers(
  prints: readonly FlowPrint[],
  maxN: number
): { shown: FlowPrint[]; truncated: number } {
  const sorted = [...prints].sort((a, b) => b.premium - a.premium);
  if (maxN <= 0 || sorted.length <= maxN) return { shown: sorted, truncated: 0 };
  return { shown: sorted.slice(0, maxN), truncated: sorted.length - maxN };
}

/** Marker descriptor consumed by the chart's createSeriesMarkers instance (same shape family as the
 *  structure markers). `time` is epoch SECONDS (lightweight-charts UTCTimestamp). */
export type FlowMarkerDesc = {
  time: number;
  position: "atPriceMiddle";
  price: number;
  color: string;
  shape: "arrowUp" | "arrowDown";
  text: string;
  size: number;
};

/**
 * Marker size scaled by premium so a $5M print reads visibly heavier than a $250K one. Log-scaled
 * between 1 and 2.4 (marker-size units) across [minPremium, ~50×minPremium], clamped — a linear scale
 * would make one whale print dwarf everything, and a fixed size would hide the magnitude the member
 * most wants to see. Pure + exported for the test.
 */
export function flowMarkerSize(premium: number, minPremium: number): number {
  const floor = minPremium > 0 ? minPremium : DEFAULT_FLOW_MIN_PREMIUM;
  if (!(premium > floor)) return 1;
  // log10 ratio: 1× floor → 0, 10× → 1, 100× → 2 …
  const decades = Math.log10(premium / floor);
  return Math.min(2.4, 1 + decades * 0.7);
}

/** Short inline label: side initial + compact premium, e.g. "C $1.2M" / "P $780K". Strike is the
 *  axis position and side is also the colour/arrow, so the text carries the premium (the headline
 *  signal) without cluttering the marker with the full strike/size string. */
export function flowMarkerText(p: FlowPrint): string {
  return `${p.side === "call" ? "C" : "P"} ${fmtPremium(p.premium)}`;
}

/**
 * Build the time-ascending marker descriptors for a set of prints. Calls → green up-arrow, puts →
 * red down-arrow, each pinned AT its strike on the price axis and at its trade time on the time axis.
 * Assumes the caller already filtered/capped; this is a pure shape map so the chart just setMarkers()s
 * the result. setMarkers requires ascending time.
 */
export function buildFlowMarkers(prints: readonly FlowPrint[], minPremium: number): FlowMarkerDesc[] {
  return prints
    .map((p) => ({
      time: Math.floor(p.tsMs / 1000),
      position: "atPriceMiddle" as const,
      price: p.strike,
      color: p.side === "call" ? FLOW_CALL_COLOR : FLOW_PUT_COLOR,
      shape: p.side === "call" ? ("arrowUp" as const) : ("arrowDown" as const),
      text: flowMarkerText(p),
      size: flowMarkerSize(p.premium, minPremium),
    }))
    .sort((a, b) => a.time - b.time);
}
