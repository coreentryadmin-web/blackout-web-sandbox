/**
 * SPX desk SESSION TIME BAR (2026-07-13) — pure band/cursor math for the thin RTH timeline
 * rendered under the desk header: playbook execution windows as labeled bands, macro-release
 * block windows, a now-cursor, and Largo voice-event dots.
 *
 * Window definitions are pulled from the REAL sources of truth, not re-typed literals:
 *   - playbook windows → PLAYBOOK_REGISTRY sessionWindow (PB-03 opening range, PB-07
 *     max-pain drift, PB-08 power hour — the desk's named execution windows);
 *   - macro windows → the same parseMacroEventTime/macroBlockWindow helpers the play
 *     engine uses to hard-block entries around releases.
 *
 * Everything here is dependency-light and clock-free (callers pass ET minutes) so it is
 * unit-testable via `tsx --test`.
 */

import {
  PLAYBOOK_REGISTRY,
  type PlaybookDefinition,
  type PlaybookId,
} from "@/features/spx/lib/playbook-registry";
import {
  macroBlockWindow,
  parseMacroEventTime,
} from "@/features/spx/lib/spx-macro-window";
import type { MacroEvent } from "@/lib/providers/macro-events";

/** RTH bounds in ET minutes-of-day: 9:30 → 16:00. */
export const RTH_START_MIN = 9 * 60 + 30;
export const RTH_END_MIN = 16 * 60;

export type TimebarTone = "or" | "drift" | "power" | "macro";

export type TimebarBand = {
  id: string;
  /** Short label drawn inside the band. */
  label: string;
  /** Hover detail (window name + exact times + source). */
  detail: string;
  startMin: number;
  endMin: number;
  tone: TimebarTone;
};

export type LanedTimebarBand = TimebarBand & { lane: 0 | 1 };

/** h:mm ET label for a minute-of-day (whole session fits one half-day, so no am/pm). */
export function fmtTimebarMinutes(min: number): string {
  const h24 = Math.floor(min / 60);
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(min % 60).padStart(2, "0")}`;
}

/** Clamp a window to RTH; null when it lies entirely outside the session. */
export function clampToSession(
  startMin: number,
  endMin: number
): { startMin: number; endMin: number } | null {
  const s = Math.max(startMin, RTH_START_MIN);
  const e = Math.min(endMin, RTH_END_MIN);
  return e > s ? { startMin: s, endMin: e } : null;
}

/** 0..100 position of an ET minute along the RTH bar (clamped). */
export function pctForEtMinutes(min: number): number {
  const pct = ((min - RTH_START_MIN) / (RTH_END_MIN - RTH_START_MIN)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** Band → {leftPct, widthPct} geometry, or null when outside the session. */
export function bandGeometry(
  band: Pick<TimebarBand, "startMin" | "endMin">
): { leftPct: number; widthPct: number } | null {
  const clamped = clampToSession(band.startMin, band.endMin);
  if (!clamped) return null;
  const leftPct = pctForEtMinutes(clamped.startMin);
  const widthPct = pctForEtMinutes(clamped.endMin) - leftPct;
  return widthPct > 0 ? { leftPct, widthPct } : null;
}

/** Now-cursor position, or null when the clock is outside RTH (cursor hidden then). */
export function nowCursorPct(etMin: number): number | null {
  if (etMin < RTH_START_MIN || etMin > RTH_END_MIN) return null;
  return pctForEtMinutes(etMin);
}

export type SessionPhase = "pre" | "rth" | "post" | "closed";

/** Session phase for the label shown when the now-cursor is hidden. */
export function sessionPhase(etMin: number, tradingDay: boolean): SessionPhase {
  if (!tradingDay) return "closed";
  if (etMin < RTH_START_MIN) return "pre";
  if (etMin > RTH_END_MIN) return "post";
  return "rth";
}

export function sessionPhaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case "pre":
      return "Pre-market · opens 9:30 ET";
    case "post":
      return "After hours · closed 4:00 ET";
    case "closed":
      return "Market closed";
    default:
      return "";
  }
}

/** The desk's named execution windows, in registry order: OR → max-pain drift → power hour. */
const WINDOW_PLAYBOOKS: ReadonlyArray<{ id: PlaybookId; label: string; tone: TimebarTone }> = [
  { id: "PB-03", label: "Opening range", tone: "or" },
  { id: "PB-07", label: "Max-pain drift", tone: "drift" },
  { id: "PB-08", label: "Power hour", tone: "power" },
];

/**
 * Curated playbook execution windows from the registry's sessionWindow definitions.
 * Curated (not all 14) because the full catalog overlaps into an unreadable smear on a
 * 28px bar — these three are the desk's distinct named windows (opening range, the
 * afternoon max-pain gravitation window, power hour). Registry stays the single source
 * of truth: if a window definition moves, the band moves with it.
 */
export function playbookWindowBands(
  registry: readonly PlaybookDefinition[] = PLAYBOOK_REGISTRY
): TimebarBand[] {
  const byId = new Map(registry.map((p) => [p.id, p]));
  const bands: TimebarBand[] = [];
  for (const w of WINDOW_PLAYBOOKS) {
    const def = byId.get(w.id);
    if (!def) continue;
    const start = def.sessionWindow.startEtHour * 60 + def.sessionWindow.startEtMin;
    const end = def.sessionWindow.endEtHour * 60 + def.sessionWindow.endEtMin;
    const clamped = clampToSession(start, end);
    if (!clamped) continue;
    bands.push({
      id: `pb-${def.id}`,
      label: w.label,
      detail: `${w.label} — ${def.name} (${def.id}) window ${fmtTimebarMinutes(clamped.startMin)}–${fmtTimebarMinutes(clamped.endMin)} ET`,
      ...clamped,
      tone: w.tone,
    });
  }
  return bands;
}

/**
 * Macro-release block windows for TODAY's events, using the same parse/window helpers the
 * play engine's macro guard uses. Overlapping windows merge into one band (three 8:30
 * prints are one block, not three stacked bands); most 8:30 releases clamp to a sliver at
 * the open (8:25→9:30 block ∩ RTH = 9:30–9:30+, kept only if ≥1min survives the clamp).
 */
export function macroWindowBands(
  events: readonly MacroEvent[],
  todayYmd: string
): TimebarBand[] {
  type Win = { startMin: number; endMin: number; names: string[] };
  const wins: Win[] = [];
  for (const ev of events) {
    if (ev.date && ev.date !== todayYmd) continue;
    const t = parseMacroEventTime(ev.time ?? "", todayYmd);
    if (!t) continue;
    const block = macroBlockWindow(t);
    const clamped = clampToSession(block.start, block.end);
    if (!clamped) continue;
    wins.push({ ...clamped, names: [ev.event] });
  }
  wins.sort((a, b) => a.startMin - b.startMin);
  const merged: Win[] = [];
  for (const w of wins) {
    const last = merged[merged.length - 1];
    if (last && w.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, w.endMin);
      last.names.push(...w.names);
    } else {
      merged.push({ ...w, names: [...w.names] });
    }
  }
  return merged.map((w, i) => ({
    id: `macro-${i}`,
    label: "Macro",
    detail: `Macro block — ${w.names.join(", ")} · ${fmtTimebarMinutes(w.startMin)}–${fmtTimebarMinutes(w.endMin)} ET`,
    startMin: w.startMin,
    endMin: w.endMin,
    tone: "macro",
  }));
}

/**
 * Greedy two-lane assignment so overlapping bands stack (top/bottom half of the bar)
 * instead of drawing on top of each other. Lane 0 preferred; a band overlapping the
 * current lane-0 occupant drops to lane 1. More than two concurrent bands is not a real
 * case for the curated set — a third overlap shares lane 1 (translucent, still readable).
 */
export function assignTimebarLanes(bands: TimebarBand[]): LanedTimebarBand[] {
  const sorted = [...bands].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnd: [number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  return sorted.map((band) => {
    const lane: 0 | 1 = band.startMin >= laneEnd[0] ? 0 : 1;
    laneEnd[lane] = Math.max(laneEnd[lane], band.endMin);
    return { ...band, lane };
  });
}

/** Hour tick positions (10:00 … 15:00) for the bar's faint gridlines. */
export function hourTickPcts(): number[] {
  const ticks: number[] = [];
  for (let m = 10 * 60; m < RTH_END_MIN; m += 60) ticks.push(pctForEtMinutes(m));
  return ticks;
}
