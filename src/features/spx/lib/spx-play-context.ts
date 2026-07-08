import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { computeWeightedConflicts } from "@/features/spx/lib/spx-play-conflicts";
import { mixedTapeBlockThreshold } from "@/features/spx/lib/spx-play-gates";
import {
  playSessionMaxEntries,
  playSessionMaxLosses,
} from "@/features/spx/lib/spx-play-config";
import type { PlaySessionMeta } from "@/features/spx/lib/spx-play-store";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import { suggestPlayStrike } from "@/features/spx/lib/spx-play-intel";
import {
  CASH_OPEN_ET_MINS,
  getEarlyCloseMinutes,
  isEtWeekday,
  isPastForceExitCutoff,
  isPastNoEntryCutoff,
} from "@/features/spx/lib/spx-play-session-guards";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";

export type SpxPlayDeskContext = {
  weighted_conflicts: number;
  mixed_tape_threshold: number;
  mixed_tape_blocked: boolean;
  session_entries_used: number;
  session_entries_max: number;
  session_losses_used: number;
  session_losses_max: number;
  minutes_to_close: number | null;
  minutes_to_no_entry: number | null;
  minutes_to_force_exit: number | null;
  gamma_flip_dist_pts: number | null;
  max_pain_dist_pts: number | null;
  suggested_strike: number | null;
  suggested_option_type: "call" | "put" | null;
};

function minutesToCashClose(now = new Date()): number | null {
  if (!isEtWeekday(now)) return null;
  const etMins = etMinutes(now);
  const closeMins = getEarlyCloseMinutes(now) ?? etClock(16, 0);
  if (etMins < CASH_OPEN_ET_MINS) return null;
  return Math.max(0, closeMins - etMins);
}

function minutesUntilNoEntry(now = new Date()): number | null {
  if (!isEtWeekday(now) || isPastNoEntryCutoff(now)) return null;
  const etMins = etMinutes(now);
  const earlyClose = getEarlyCloseMinutes(now);
  const cutoffMins =
    earlyClose != null ? earlyClose - 30 : etClock(15, 30);
  if (etMins >= cutoffMins) return null;
  return cutoffMins - etMins;
}

function minutesUntilForceExit(now = new Date()): number | null {
  if (!isEtWeekday(now) || isPastForceExitCutoff(now)) return null;
  const etMins = etMinutes(now);
  const earlyClose = getEarlyCloseMinutes(now);
  const cutoffMins = earlyClose != null ? earlyClose - 10 : etClock(15, 45);
  if (etMins >= cutoffMins) return null;
  return cutoffMins - etMins;
}

export function buildSpxPlayDeskContext(
  desk: SpxDeskPayload,
  payload: Pick<
    SpxPlayPayload,
    "score" | "grade" | "factors" | "direction"
  >,
  session?: PlaySessionMeta | null,
  now = new Date()
): SpxPlayDeskContext {
  const abs = Math.abs(payload.score);
  const { weighted_conflicts } = computeWeightedConflicts(
    desk,
    payload.score,
    payload.factors
  );
  const mixed_tape_threshold = mixedTapeBlockThreshold(payload.grade, abs);
  const entriesUsed = session?.session_entries_today ?? 0;
  const lossesUsed = session?.session_losses_today ?? 0;
  const entriesMax = playSessionMaxEntries();
  const lossesMax = playSessionMaxLosses();

  let suggested_strike: number | null = null;
  let suggested_option_type: "call" | "put" | null = null;
  if (payload.direction === "long" || payload.direction === "short") {
    suggested_strike = suggestPlayStrike(desk, payload.direction, payload.grade);
    suggested_option_type = payload.direction === "long" ? "call" : "put";
  }

  const gamma_flip_dist_pts =
    desk.gamma_flip != null ? Math.round((desk.price - desk.gamma_flip) * 10) / 10 : null;
  const max_pain_dist_pts =
    desk.max_pain != null ? Math.round((desk.price - desk.max_pain) * 10) / 10 : null;

  return {
    weighted_conflicts,
    mixed_tape_threshold,
    mixed_tape_blocked: weighted_conflicts >= mixed_tape_threshold,
    session_entries_used: entriesUsed,
    session_entries_max: entriesMax,
    session_losses_used: lossesUsed,
    session_losses_max: lossesMax,
    minutes_to_close: minutesToCashClose(now),
    minutes_to_no_entry: minutesUntilNoEntry(now),
    minutes_to_force_exit: minutesUntilForceExit(now),
    gamma_flip_dist_pts,
    max_pain_dist_pts,
    suggested_strike,
    suggested_option_type,
  };
}

export function enrichPlayPayload(
  payload: SpxPlayPayload,
  desk: SpxDeskPayload,
  session?: PlaySessionMeta | null
): SpxPlayPayload {
  return {
    ...payload,
    desk_context: buildSpxPlayDeskContext(desk, payload, session),
  };
}
