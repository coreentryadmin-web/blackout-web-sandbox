// Shared PURE helpers for the Cortex source modules. Not a source itself — just the
// tiny common vocabulary (number formatting, absent-item construction, time math)
// so every source states its evidence the same way and the narrative guard test has
// ONE formatting convention to verify. No IO, no Date.now() — time always arrives
// as an explicit input (types.ts CortexInputs.now).

import type { CortexInputs, CortexSourceId, EvidenceItem } from "../types";

/**
 * Format a number for a detail sentence: up to 2 decimals, trailing zeros trimmed,
 * never exponential. Guards against non-finite inputs at the call boundary — a
 * source must never let NaN/Infinity reach a member-facing string (the narrative
 * guard test forbids those tokens outright).
 */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) throw new TypeError(`fmtNum: non-finite value ${v}`);
  // toFixed(2) then trim — avoids float-noise renderings like 7499.360000000001
  // (the systemic unrounded-float class documented in CLAUDE.md).
  return Number(v.toFixed(2)).toString();
}

/** Format a dollar premium as $X.XM (1 decimal) — the flow/dark-pool convention. */
export function fmtMillions(v: number): string {
  if (!Number.isFinite(v)) throw new TypeError(`fmtMillions: non-finite value ${v}`);
  return `$${Number((v / 1_000_000).toFixed(1))}M`;
}

/** The uniform "this source cannot answer" item — visible, worth zero (design §0:
 *  absence is signal-neutral, never fabricated). asOf is the snapshot's own now:
 *  an absence is a statement about THIS composition instant, so it never decays
 *  into a second-order staleness state. */
export function absentItem(source: CortexSourceId, input: CortexInputs, reason: string): EvidenceItem {
  return {
    source,
    stance: "absent",
    weight: 0,
    halfLifeSec: 0,
    asOf: input.now,
    detail: reason,
  };
}

/** The absent item for a slice whose READER failed (fetch.ts recorded the error
 *  class) vs one that returned nothing — the two reasons must read differently
 *  (the "genuinely quiet" vs "we can't see" distinction, ecosystem-context.ts). */
export function absentForMissingSlice(
  source: CortexSourceId,
  input: CortexInputs,
  noDataReason: string
): EvidenceItem {
  const err = input.errors[source];
  return absentItem(source, input, err ? `reader failed (${err})` : noDataReason);
}

/** Parse an ISO timestamp to epoch ms; null when absent/unparseable (never a
 *  fabricated "now" — the caller decides what an unknown time means). */
export function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Minutes-of-day in America/New_York for an epoch-ms instant — the deterministic
 * time-of-day input for the charm heuristic (design §1: charm dominates expiry
 * afternoons). Uses Intl (pure given its input) rather than importing a provider
 * module into the composer's dependency graph.
 */
export function etMinutesOfDay(epochMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}
