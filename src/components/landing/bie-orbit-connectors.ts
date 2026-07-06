// The visual links that make BIE read as an ecosystem, not a hub with six
// disconnected decorations parked near it. Two kinds of connection:
//  1. Tool <-> core, BIDIRECTIONAL — raw telemetry flows tool -> core (tool's
//     own accent color) and verified intelligence flows core -> tool (BIE's
//     cyan), echoing the readout lines "ingested, verified" (in) and "the
//     engine never stops learning" (out, back to the instruments).
//  2. Tool <-> tool, a single faint hexagon loop connecting all six in a
//     fixed order, with ONE traveling "context" pulse continuously visiting
//     every tool in turn — the tools don't just feed BIE, they're part of
//     one connected system. Deliberately ONE loop pulse, not six: the whole
//     point of these two milestones' restraint principle is one meaningful
//     motion per relationship, not a firehose of simultaneous particles.
// Pure geometry/timing, split out so it's unit-testable without a browser/DOM.

export type Point = { x: number; y: number };

/**
 * Per-tool pulse period so six instruments don't pulse in lockstep — a
 * uniform blink-together reads as mechanical, staggered reads as organic
 * (six independent live feeds, not one timer fanned out).
 */
export function pulsePeriodSecForIndex(index: number): number {
  return 2.6 + index * 0.55;
}

/** Stagger starting phase evenly across the loop so pulses don't bunch up on mount. */
export function pulsePhaseForIndex(index: number, count: number): number {
  return count > 0 ? index / count : 0;
}

/** Advance a looping 0..1 pulse phase by one animation tick. */
export function advancePulseT(current: number, dtSec: number, periodSec: number): number {
  if (periodSec <= 0 || dtSec <= 0) return current;
  const next = current + dtSec / periodSec;
  return next % 1;
}

/** Position along a line at phase t (0 = at `from`, 1 = at `to`). Direction-agnostic — callers pick tool->core or core->tool by argument order. */
export function connectorPulsePosition(from: Point, to: Point, t: number): Point {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

/** Fades in leaving `from` and out arriving at `to`, so a traveling pulse never pops. */
export function connectorPulseOpacity(t: number, fadeFraction = 0.18): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (fadeFraction <= 0) return 1;
  const fadeIn = Math.min(1, clamped / fadeFraction);
  const fadeOut = Math.min(1, (1 - clamped) / fadeFraction);
  return Math.min(fadeIn, fadeOut);
}

/**
 * Outbound (core -> tool) runs on its own phase, offset half a cycle from
 * the inbound (tool -> core) pulse on the same line, so the two never sit on
 * top of each other — they read as two distinct handshakes, not one blob.
 */
export function outboundPulsePhaseForIndex(index: number, count: number): number {
  return (pulsePhaseForIndex(index, count) + 0.5) % 1;
}

/** How long the single ecosystem pulse takes to visit all six tools once. */
export const ECOSYSTEM_LOOP_PERIOD_SEC = 9;

/** Which mesh edge (0-indexed, tool i -> tool i+1) the loop pulse currently sits on. */
export function loopSegmentIndex(loopT: number, segmentCount: number): number {
  if (segmentCount <= 0) return 0;
  const t = ((loopT % 1) + 1) % 1;
  return Math.min(segmentCount - 1, Math.floor(t * segmentCount));
}

/** Progress (0..1) within the current mesh edge. */
export function loopSegmentLocalT(loopT: number, segmentCount: number): number {
  if (segmentCount <= 0) return 0;
  const t = ((loopT % 1) + 1) % 1;
  return (t * segmentCount) % 1;
}

/** Build the fixed cyclic edge list connecting `count` tools into one loop (0-1, 1-2, ..., last-0). */
export function buildMeshEdges(count: number): Array<[number, number]> {
  if (count <= 1) return [];
  return Array.from({ length: count }, (_, i) => [i, (i + 1) % count]);
}
