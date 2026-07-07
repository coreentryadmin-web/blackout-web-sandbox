import {
  playChainMaxSpreadPct,
  playChainMaxSpreadPctOpen,
  playChainOpenSpreadMinutes,
} from "@/features/spx/lib/spx-play-config";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";

const CASH_OPEN_ET = etClock(9, 30);

/** Time-gated spread filter: looser cap in the first N minutes after 9:30 AM ET. */
export function effectiveChainMaxSpreadPct(now = new Date()): number {
  const etMins = etMinutes(now);
  const openWindowEnd = CASH_OPEN_ET + playChainOpenSpreadMinutes();
  if (etMins >= CASH_OPEN_ET && etMins < openWindowEnd) {
    return playChainMaxSpreadPctOpen();
  }
  return playChainMaxSpreadPct();
}

export function chainSpreadFilterLabel(now = new Date()): string {
  const pct = effectiveChainMaxSpreadPct(now);
  const etMins = etMinutes(now);
  const inOpen = etMins >= CASH_OPEN_ET && etMins < CASH_OPEN_ET + playChainOpenSpreadMinutes();
  return inOpen
    ? `${pct}% (open window — first ${playChainOpenSpreadMinutes()}m after 9:30 AM ET)`
    : `${pct}%`;
}
