import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";

/** Session OR break memory for PB-14 failed-breakout detection. */
export type OrBreakMemory = {
  session_date: string;
  or_high: number | null;
  or_low: number | null;
  broke_above_or_high: boolean;
  broke_below_or_low: boolean;
  reentered_after_high_break: boolean;
  reentered_after_low_break: boolean;
  updated_at: string;
};

export function emptyOrBreakMemory(sessionDate: string): OrBreakMemory {
  return {
    session_date: sessionDate,
    or_high: null,
    or_low: null,
    broke_above_or_high: false,
    broke_below_or_low: false,
    reentered_after_high_break: false,
    reentered_after_low_break: false,
    updated_at: new Date().toISOString(),
  };
}

/** Advance break/re-entry flags from current desk + OR levels. */
export function updateOrBreakMemory(
  prev: OrBreakMemory,
  desk: SpxDeskPayload,
  technicals: PlayTechnicals
): OrBreakMemory {
  if (!technicals.or_defined || technicals.or_high == null || technicals.or_low == null) {
    return { ...prev, updated_at: new Date().toISOString() };
  }

  const orHigh = technicals.or_high;
  const orLow = technicals.or_low;
  const price = desk.price;
  const insideOr = price >= orLow && price <= orHigh;

  let brokeAbove = prev.broke_above_or_high;
  let brokeBelow = prev.broke_below_or_low;
  let reenteredHigh = prev.reentered_after_high_break;
  let reenteredLow = prev.reentered_after_low_break;

  // Fresh break wave clears stale re-entry latch (prevents hours-later PB-14 re-arm).
  if (price > orHigh) {
    if (!brokeAbove) reenteredHigh = false;
    brokeAbove = true;
  }
  if (price < orLow) {
    if (!brokeBelow) reenteredLow = false;
    brokeBelow = true;
  }

  if (insideOr && brokeAbove) reenteredHigh = true;
  if (insideOr && brokeBelow) reenteredLow = true;

  return {
    session_date: prev.session_date,
    or_high: orHigh,
    or_low: orLow,
    broke_above_or_high: brokeAbove,
    broke_below_or_low: brokeBelow,
    reentered_after_high_break: reenteredHigh,
    reentered_after_low_break: reenteredLow,
    updated_at: new Date().toISOString(),
  };
}

export function pb14LongBreakReady(memory: OrBreakMemory): boolean {
  return memory.reentered_after_low_break;
}

export function pb14ShortBreakReady(memory: OrBreakMemory): boolean {
  return memory.reentered_after_high_break;
}
