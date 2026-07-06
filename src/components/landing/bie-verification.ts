// The BIE hero's defining behavior, made visible: not every inbound signal is
// confirmed. Most are — but some are rejected at the gate and never reach the
// core. This is the one thing a generic "AI energy core" animation can't show
// and BIE's actual numeric-grounding guard does every day: refusing to pass
// through a claim that doesn't check out. Split out (like the rest of this
// component's geometry) so the decision/geometry is unit-testable without a
// browser/DOM.

import { pointOnEllipse } from "./bie-brain-geometry";

export type VerificationOutcome = "verified" | "rejected";

/**
 * Share of inbound signals that resolve as verified vs. rejected. Deliberately
 * NOT 100% or 99% — a rejection that only shows once in a blue moon reads as
 * "never happens," which is the exact false impression the redesign is
 * correcting. ~1 in 6 cycles failing is frequent enough that a visitor who
 * watches for 30-60s actually sees it happen.
 */
export const VERIFIED_PROBABILITY = 0.82;

/** Pure decision — inject `rand` for deterministic tests, default to Math.random live. */
export function resolveVerification(rand: () => number = Math.random): VerificationOutcome {
  return rand() < VERIFIED_PROBABILITY ? "verified" : "rejected";
}

export type GateTick = { x1: number; y1: number; x2: number; y2: number; angleDeg: number };

/**
 * The verification gate — a ring of tick marks around the core, like an
 * aperture/dial. `innerR`/`outerR` are LOCAL coordinates (the gate group is
 * already translated to the core position by its parent `<g>`), so this is
 * pure trig with no dependency on core position.
 */
export function buildGateTicks(count: number, innerR: number, outerR: number): GateTick[] {
  const ticks: GateTick[] = [];
  for (let i = 0; i < count; i++) {
    const angleDeg = (360 / count) * i;
    const inner = pointOnEllipse(0, 0, innerR, innerR, angleDeg);
    const outer = pointOnEllipse(0, 0, outerR, outerR, angleDeg);
    ticks.push({ x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, angleDeg });
  }
  return ticks;
}
