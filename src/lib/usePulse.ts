"use client";

import { useReducedMotion, type TargetAndTransition, type Transition } from "framer-motion";

/**
 * MotionConfig reducedMotion="user" only disables transform/position keys (x, y,
 * scale, width, ...). Opacity and textShadow loops slip through, so gate them
 * explicitly. Returns animate/transition props for a repeating pulse, or static
 * (undefined) props when the user prefers reduced motion — spread onto a motion.*
 * element via {...usePulse(...)}.
 *
 * Rules of Hooks: this calls useReducedMotion(), so it must be invoked at the top
 * of a component (above any early return), never conditionally.
 */
export function usePulse(
  animate: TargetAndTransition,
  transition: Transition
): { animate?: TargetAndTransition; transition?: Transition } {
  const reduce = useReducedMotion();
  if (reduce) return { animate: undefined, transition: undefined };
  return { animate, transition };
}
