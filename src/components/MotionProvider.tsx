"use client";

import { MotionConfig } from "framer-motion";

/**
 * Wraps the app so every framer-motion animation respects the OS
 * prefers-reduced-motion setting. reducedMotion="user" disables transform/position
 * animations (x, y, scale, rotate, width, height, ...) for users who opted out,
 * while leaving opacity/color intact. NOTE: opacity & textShadow loops are NOT
 * covered here — those are gated per-component with useReducedMotion() (see usePulse).
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
