import { tryAdvisoryLock, releaseAdvisoryLock } from "@/lib/db";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { PlayTechnicals } from "@/lib/spx-play-technicals";
import {
  evaluateSpxLotto,
  readSpxLottoSnapshot,
  type LottoPlayPayload,
} from "@/lib/spx-lotto-engine";
import {
  evaluateSpxPowerHour,
  readSpxPowerHourSnapshot,
  type PowerHourPlayPayload,
} from "@/lib/spx-power-hour-engine";

/** Distinct from SPX_EVAL_LOCK_ID — lotto/power-hour are an independent writer. */
const LOTTO_PH_LOCK = "spx-lotto-powerhour";

/**
 * Run the MUTATING lotto + power-hour engines under a single non-blocking advisory lock
 * so the two writers — the spx-evaluate cron and the admin live-mutate path — can never
 * race the shared lotto/power-hour records (last-write-wins corruption) or double-fire
 * Discord. If the lock is already held by the other writer, render the read-only
 * snapshots instead (no mutation, no alerts): the holder advances state and this caller
 * self-heals on the next tick.
 *
 * Safety notes:
 * - tryAdvisoryLock is non-blocking (pg_try_advisory_lock) and try-only, so two writers
 *   contending can never deadlock — the loser simply skips.
 * - The lock is released in a finally (and Postgres auto-releases the session lock if the
 *   process dies), so it cannot leak and silently stall evaluation.
 * - When DATABASE_URL is unset (dev), tryAdvisoryLock returns true and releaseAdvisoryLock
 *   is a no-op, so behavior is identical to the pre-lock code path.
 */
export async function runLottoPowerHourLocked(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals | null
): Promise<{ lotto: LottoPlayPayload; powerHour: PowerHourPlayPayload }> {
  const acquired = await tryAdvisoryLock(LOTTO_PH_LOCK);
  if (!acquired) {
    const [lotto, powerHour] = await Promise.all([
      readSpxLottoSnapshot(),
      readSpxPowerHourSnapshot(desk),
    ]);
    return { lotto, powerHour };
  }
  try {
    const [lotto, powerHour] = await Promise.all([
      evaluateSpxLotto(desk, technicals),
      evaluateSpxPowerHour(desk, technicals),
    ]);
    return { lotto, powerHour };
  } finally {
    await releaseAdvisoryLock(LOTTO_PH_LOCK);
  }
}
