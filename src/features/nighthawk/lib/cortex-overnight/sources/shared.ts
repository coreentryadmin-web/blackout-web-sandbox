// Shared PURE helpers for the OVERNIGHT cortex source modules. Not a source itself —
// just the tiny common vocabulary (number formatting, absent-item construction, date
// math) so every source states its evidence the same way. No IO, no Date.now() —
// time always arrives as an explicit input (types.ts OvernightInputs.now).

import type { OvernightInputs, OvernightSourceId, OvernightEvidenceItem } from "../types";

/** Format a number for a detail sentence: up to 2 decimals, trailing zeros trimmed,
 *  never exponential. Guards non-finite inputs — a member-facing string must never
 *  carry NaN/Infinity (and never a float-noise rendering like 7499.360000000001, the
 *  systemic unrounded-float class documented in CLAUDE.md). */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) throw new TypeError(`fmtNum: non-finite value ${v}`);
  return Number(v.toFixed(2)).toString();
}

/** Format a dollar premium as $X.XM (1 decimal) — the flow/dark-pool convention. */
export function fmtMillions(v: number): string {
  if (!Number.isFinite(v)) throw new TypeError(`fmtMillions: non-finite value ${v}`);
  return `$${Number((v / 1_000_000).toFixed(1))}M`;
}

/** The uniform "this source cannot answer" item — visible, worth zero (absence is
 *  signal-neutral, never fabricated). asOf is the snapshot's own now: an absence is a
 *  statement about THIS composition instant. */
export function absentItem(
  source: OvernightSourceId,
  input: OvernightInputs,
  reason: string
): OvernightEvidenceItem {
  return { source, stance: "absent", weight: 0, asOf: input.now, detail: reason };
}

/** The absent item for a slice whose extractor FAILED (build-inputs recorded the
 *  error class) vs one that returned nothing — the two reasons must read differently
 *  (the "genuinely quiet" vs "we can't see" distinction). */
export function absentForMissingSlice(
  source: OvernightSourceId,
  input: OvernightInputs,
  noDataReason: string
): OvernightEvidenceItem {
  const err = input.errors[source];
  return absentItem(source, input, err ? `reader failed (${err})` : noDataReason);
}

/** Parse a YYYY-MM-DD (or ISO) date to a UTC day-count integer for ordering; null when
 *  unparseable. We compare DATES, not instants — a calendar day is the grading unit,
 *  so both operands are normalized to their YYYY-MM-DD prefix first. */
export function dayNumber(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const ymd = String(dateStr).slice(0, 10);
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86_400_000);
}
