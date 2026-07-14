/**
 * Chart-marker descriptors for market structure (CTO#2 slice 2) — maps the pure engine's pivots
 * and BOS/CHOCH events to the lightweight-charts series-marker shape the chart already uses for
 * the wall beads (a separate createSeriesMarkers instance, so beads and structure never collide).
 *
 * Visual language:
 * - Pivot labels: text-only markers (size 0 hides the shape glyph) — HH/HL in green (structure
 *   holding), LH/LL in red (structure weakening), the first unlabelled H/L in slate. Highs sit
 *   aboveBar, lows belowBar.
 * - Breaks: BOS = cyan arrow in the break direction (continuation); CHOCH = amber arrow (the
 *   character change) — both at the bar whose CLOSE broke the level, labelled with the type.
 *
 * Pure (engine output in → descriptors out) so the composition is unit-tested; the chart just
 * setMarkers()'s the result.
 */

import { labelPivots, detectStructureEvents, type StructureBar } from "./vector-market-structure";

export type StructureMarkerDesc = {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "circle" | "arrowUp" | "arrowDown";
  text: string;
  size: number;
};

const UP_COLOR = "#34d399"; // green — structure holding (HH/HL)
const DOWN_COLOR = "#f87171"; // red — structure weakening (LH/LL)
const FIRST_COLOR = "#94a3b8"; // slate — the unlabelled first pivots
const BOS_COLOR = "#22d3ee"; // cyan — continuation break
const CHOCH_COLOR = "#f59e0b"; // amber — character change

/** Build the full, time-ascending marker list for the displayed bars. [] without structure. */
export function buildStructureMarkers(bars: readonly StructureBar[], k: number): StructureMarkerDesc[] {
  const markers: StructureMarkerDesc[] = [];
  for (const p of labelPivots(bars, k)) {
    markers.push({
      time: p.time,
      position: p.kind === "high" ? "aboveBar" : "belowBar",
      color: p.label === "HH" || p.label === "HL" ? UP_COLOR : p.label === "LH" || p.label === "LL" ? DOWN_COLOR : FIRST_COLOR,
      shape: "circle",
      text: p.label,
      size: 0, // text-only: the label IS the marker
    });
  }
  for (const e of detectStructureEvents(bars, k)) {
    markers.push({
      time: e.time,
      position: e.direction === "up" ? "belowBar" : "aboveBar", // arrow points INTO the break bar
      color: e.type === "BOS" ? BOS_COLOR : CHOCH_COLOR,
      shape: e.direction === "up" ? "arrowUp" : "arrowDown",
      text: e.type,
      size: 1,
    });
  }
  // setMarkers requires ascending time; pivots and their (later) break bars interleave.
  return markers.sort((a, b) => a.time - b.time);
}
