import type { PlaybookId } from "@/features/spx/lib/playbook-registry";
import type { PlaybookLifecycleState } from "@/features/spx/lib/playbook-state";
import type { PlaybookMatchVerdict } from "@/features/spx/lib/playbook-shadow-matcher";
import { playbookInstanceId } from "@/features/spx/lib/playbook-state";

/** Minimum armed polls before a trigger can commit (≈4–6s at 2s play poll). */
export function playbookMinArmedPolls(): number {
  const n = Number(process.env.PLAYBOOK_MIN_ARMED_POLLS ?? "2");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

export type PlaybookArmedPollCounts = ReadonlyMap<string, number>;

/**
 * Stateful guard — trigger requires prior armed state + minimum armed poll count.
 * Prevents same-tick arm→fire and tick-recomputed false triggers.
 */
export function applyPlaybookVerdictGuards(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  prevByInstance: ReadonlyMap<string, PlaybookLifecycleState>,
  armedPollCounts: PlaybookArmedPollCounts
): PlaybookMatchVerdict[] {
  const minArmed = playbookMinArmedPolls();

  return verdicts.map((v) => {
    if (!v.trigger_fired) return v;

    const instanceId = playbookInstanceId(sessionDate, v.playbook_id);
    const prev = prevByInstance.get(instanceId) ?? "idle";
    const armedPolls = armedPollCounts.get(instanceId) ?? 0;
    const hadArmed = prev === "armed" || prev === "triggered" || armedPolls >= minArmed;

    if (hadArmed && armedPolls >= minArmed) return v;

    return {
      ...v,
      trigger_fired: false,
      direction: null,
      detail: `${v.detail} [guard: armed_polls=${armedPolls}, prev=${prev}, need≥${minArmed}]`,
    };
  });
}

/** Increment armed poll counter for instances with precondition_match this tick. */
export function nextArmedPollCounts(
  sessionDate: string,
  verdicts: readonly PlaybookMatchVerdict[],
  prev: PlaybookArmedPollCounts
): Map<string, number> {
  const next = new Map(prev);
  for (const v of verdicts) {
    if (!v.precondition_match || !v.regime_eligible || !v.session_window_open) continue;
    const id = playbookInstanceId(sessionDate, v.playbook_id);
    next.set(id, (next.get(id) ?? 0) + 1);
  }
  return next;
}

export type PlaybookExitProfile = {
  trim_mfe_mult: number;
  trail_window_mult: number;
  thesis_break_mult: number;
  label: string;
};

const DEFAULT_EXIT: PlaybookExitProfile = {
  trim_mfe_mult: 1,
  trail_window_mult: 1,
  thesis_break_mult: 1,
  label: "default",
};

/** Playbook-specific exit tuning when `open_play.playbook_id` is set. */
export function playbookExitProfile(playbookId: string | null | undefined): PlaybookExitProfile {
  if (!playbookId) return DEFAULT_EXIT;

  const profiles: Partial<Record<PlaybookId, PlaybookExitProfile>> = {
    "PB-01": { trim_mfe_mult: 0.9, trail_window_mult: 0.85, thesis_break_mult: 1.1, label: "vwap_reclaim" },
    "PB-02": { trim_mfe_mult: 0.85, trail_window_mult: 0.8, thesis_break_mult: 1.15, label: "vwap_reject" },
    "PB-03": { trim_mfe_mult: 1.1, trail_window_mult: 1.15, thesis_break_mult: 0.95, label: "orb_continuation" },
    "PB-04": { trim_mfe_mult: 0.75, trail_window_mult: 0.7, thesis_break_mult: 1.2, label: "pin_fade_scalp" },
    "PB-11": { trim_mfe_mult: 0.7, trail_window_mult: 0.65, thesis_break_mult: 1.25, label: "chop_scalp" },
    "PB-14": { trim_mfe_mult: 0.95, trail_window_mult: 0.9, thesis_break_mult: 1.05, label: "failed_break" },
  };

  return profiles[playbookId as PlaybookId] ?? DEFAULT_EXIT;
}
