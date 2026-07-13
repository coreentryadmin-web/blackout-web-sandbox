import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { VectorDteHorizon } from "./vector-dte-horizon";
import type { GexLadder } from "./vector-gex-ladder";
import type { ExpectedMove } from "./vector-expected-move";

/**
 * VectorHorizonSnapshot — the ONE client-side source of truth for every narrated/displayed
 * level on the Vector page (chart banner kings + flip + max-pain line, GEX ladder rows, desk
 * terminal citations, expected-move cone).
 *
 * WHY: each surface used to fetch its own endpoint on its own cadence (chart walls via the DTE
 * effect, ladder via its own 15s poll, max-pain/expected-move via separate fetches, terminal
 * derived from chart refs) — four cadences, four in-flight races, and members could read THREE
 * different numbers for "the" call wall at the same instant. This module is the pure core of the
 * fix: one fetch CYCLE per (ticker, horizon) pulls walls+flip, ladder rows+spot, max-pain and
 * expected-move TOGETHER, stamps them with a single `asOf`, and swaps them in as one frozen
 * object. Surfaces render THIS object or nothing — never a mix of cycles.
 *
 * Pure and dependency-free (fetching lives in use-vector-horizon-snapshot.ts) so the swap /
 * staleness / invalidation rules are unit-testable under `tsx --test`.
 */
export type VectorHorizonSnapshot = {
  ticker: string;
  horizon: VectorDteHorizon;
  /** ONE stamp (ms epoch) for the whole fetch cycle — every surface shows numbers from this instant. */
  asOf: number;
  /** Horizon-scoped GEX walls (top call/put etc. — the chart/banner/terminal levels). */
  walls: GexWalls | null;
  /** Horizon-scoped gamma flip. */
  flip: number | null;
  /** Per-strike ladder rows for the side panel — same expiries as `walls`. */
  ladder: GexLadder | null;
  /** Spot from the ladder read (header display; the chart's tape spot stays SSE-driven). */
  spot: number | null;
  maxPain: number | null;
  expectedMove: ExpectedMove | null;
};

/** One sub-fetch's outcome inside a cycle. `ok:false` = transport/HTTP failure (value unusable);
 *  `ok:true` with a null value = the endpoint answered honestly that there is no data. */
export type HorizonPart<T> = { ok: boolean; value: T | null };

/** The four coupled reads of one cycle, before they are swapped in as a snapshot. */
export type VectorHorizonCycle = {
  walls: HorizonPart<{ walls: GexWalls | null; flip: number | null }>;
  ladder: HorizonPart<{ ladder: GexLadder | null; spot: number | null }>;
  maxPain: HorizonPart<number>;
  expectedMove: HorizonPart<ExpectedMove>;
};

/** A snapshot is only usable by a surface currently showing the SAME (ticker, horizon). */
export function snapshotMatches(
  snap: VectorHorizonSnapshot | null | undefined,
  ticker: string,
  horizon: VectorDteHorizon
): snap is VectorHorizonSnapshot {
  return Boolean(snap && snap.ticker === ticker && snap.horizon === horizon);
}

/** 3 missed 15s cycles — beyond this the shared numbers are older than any surface should trust. */
export const HORIZON_SNAPSHOT_STALE_MS = 45_000;

export function isSnapshotStale(
  snap: VectorHorizonSnapshot | null | undefined,
  nowMs: number,
  maxAgeMs: number = HORIZON_SNAPSHOT_STALE_MS
): boolean {
  if (!snap) return true;
  return nowMs - snap.asOf > maxAgeMs;
}

/**
 * ATOMIC SWAP — decide what the store holds after one fetch cycle.
 *
 * - Every part ok → a NEW frozen snapshot from this cycle (the normal 15s tick).
 * - Any part failed AND the previous snapshot is still for this (ticker, horizon) → keep the
 *   PREVIOUS snapshot object untouched. Coherence beats freshness: patching the succeeded parts
 *   over the old ones would stamp one `asOf` on values from two different instants — exactly the
 *   mixed story this store exists to kill. The old snapshot is complete and self-consistent; the
 *   surfaces just show it (and its honest asOf) a cycle longer.
 * - Any part failed AND there is no usable previous (first load, or the member just switched
 *   ticker/horizon so the old snapshot is for a different key) → build the snapshot from the
 *   parts that DID succeed, failed parts null. All values still come from this one cycle (one
 *   instant), so it's coherent — just honestly incomplete. Never resurrect a mismatched-key prev.
 *
 * The returned object is FROZEN (deep-frozen at the top level of each field container) so no
 * consumer can mutate the shared story in place — a surface can only ever re-render from a whole
 * new snapshot reference.
 */
export function nextHorizonSnapshot(
  prev: VectorHorizonSnapshot | null,
  ticker: string,
  horizon: VectorDteHorizon,
  cycle: VectorHorizonCycle,
  asOf: number
): VectorHorizonSnapshot | null {
  const allOk = cycle.walls.ok && cycle.ladder.ok && cycle.maxPain.ok && cycle.expectedMove.ok;
  if (!allOk && snapshotMatches(prev, ticker, horizon)) return prev;
  const snap: VectorHorizonSnapshot = {
    ticker,
    horizon,
    asOf,
    walls: cycle.walls.ok ? cycle.walls.value?.walls ?? null : null,
    flip: cycle.walls.ok ? cycle.walls.value?.flip ?? null : null,
    ladder: cycle.ladder.ok ? cycle.ladder.value?.ladder ?? null : null,
    spot: cycle.ladder.ok ? cycle.ladder.value?.spot ?? null : null,
    maxPain: cycle.maxPain.ok ? cycle.maxPain.value : null,
    expectedMove: cycle.expectedMove.ok ? cycle.expectedMove.value : null,
  };
  return Object.freeze(snap);
}

/**
 * The subtle shared-stamp label surfaces render ("as of 2:32:15 PM") — ET, with seconds, so a
 * member can SEE that the ladder and the terminal cite the same instant.
 */
export function formatSnapshotClock(asOfMs: number): string {
  return new Date(asOfMs).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}
