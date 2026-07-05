// The visual link between each orbit tool and the core. Without this, the six
// product icons read as decoration floating near the reactor rather than
// instruments feeding it — there's nothing on screen showing that SPX Slayer,
// HELIX, etc. actually connect to BIE. A thin static line plus a continuously
// traveling pulse (tool -> core) makes "every tool streams data into BIE"
// legible at a glance, echoing the existing readout line "continuous market
// intelligence — ingested, verified, never assumed". Pure geometry/timing,
// split out so it's unit-testable without a browser/DOM.

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

/** Position along the tool -> core line at phase t (0 = at the tool, 1 = at the core). */
export function connectorPulsePosition(core: Point, tool: Point, t: number): Point {
  return {
    x: tool.x + (core.x - tool.x) * t,
    y: tool.y + (core.y - tool.y) * t,
  };
}

/** Fades in leaving the tool and out arriving at the core, so it never pops. */
export function connectorPulseOpacity(t: number, fadeFraction = 0.18): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (fadeFraction <= 0) return 1;
  const fadeIn = Math.min(1, clamped / fadeFraction);
  const fadeOut = Math.min(1, (1 - clamped) / fadeFraction);
  return Math.min(fadeIn, fadeOut);
}
