"use client";

import { clsx } from "clsx";
import type { SpxPlayDeskContext } from "@/features/spx/lib/spx-play-context";
import type { SpxPlayAction } from "@/features/spx/lib/spx-play-engine";

type Props = {
  ctx: SpxPlayDeskContext;
  action: SpxPlayAction;
  compact?: boolean;
};

function conflictTone(ratio: number, blocked: boolean): string {
  if (blocked || ratio >= 1) return "spx-play-ctx-meter--hot";
  if (ratio >= 0.75) return "spx-play-ctx-meter--warm";
  return "spx-play-ctx-meter--cool";
}

export function SpxPlayHeroStrip({ ctx, action, compact = false }: Props) {
  const conflictRatio =
    ctx.mixed_tape_threshold > 0
      ? ctx.weighted_conflicts / ctx.mixed_tape_threshold
      : 0;
  const entriesLeft = Math.max(0, ctx.session_entries_max - ctx.session_entries_used);
  const lossesLeft = Math.max(0, ctx.session_losses_max - ctx.session_losses_used);

  const showTheta =
    action === "BUY" || action === "HOLD" || action === "TRIM" || action === "WATCHING";

  return (
    <div className={clsx("spx-play-hero-strip", compact && "spx-play-hero-strip--compact")}>
      <div className="spx-play-ctx-meter" title="Weighted conflict score vs mixed-tape block threshold">
        <div className="spx-play-ctx-meter-head">
          <span className="spx-play-ctx-label">Tape conflict</span>
          <span className="spx-play-ctx-value tabular-nums">
            {ctx.weighted_conflicts}/{ctx.mixed_tape_threshold}
          </span>
        </div>
        <div className="spx-play-ctx-meter-track" aria-hidden>
          <div
            className={clsx("spx-play-ctx-meter-fill", conflictTone(conflictRatio, ctx.mixed_tape_blocked))}
            style={{ width: `${Math.min(100, Math.round(conflictRatio * 100))}%` }}
          />
        </div>
        {ctx.mixed_tape_blocked && (
          <p className="spx-play-ctx-hint text-amber-300/90">Mixed tape — entry blocked</p>
        )}
      </div>

      <div className="spx-play-ctx-budget" title="Session entry and loss budget">
        <span className="spx-play-ctx-label">Session</span>
        <span className="spx-play-ctx-value tabular-nums">
          {entriesLeft} entries · {lossesLeft} loss room
        </span>
      </div>

      {showTheta && ctx.minutes_to_close != null && (
        <div className="spx-play-ctx-time" title="Minutes until cash close">
          <span className="spx-play-ctx-label">Close</span>
          <span
            className={clsx(
              "spx-play-ctx-value tabular-nums",
              ctx.minutes_to_close <= 45 && "text-amber-300"
            )}
          >
            {ctx.minutes_to_close}m
          </span>
        </div>
      )}

      {showTheta && ctx.minutes_to_no_entry != null && ctx.minutes_to_no_entry <= 90 && (
        <div className="spx-play-ctx-time">
          <span className="spx-play-ctx-label">No entry</span>
          <span className="spx-play-ctx-value tabular-nums text-orange-300">
            {ctx.minutes_to_no_entry}m
          </span>
        </div>
      )}

      {ctx.gamma_flip_dist_pts != null && (
        <div className="spx-play-ctx-chip" title="Distance to gamma flip">
          <span className="spx-play-ctx-label">γ-flip</span>
          <span
            className={clsx(
              "spx-play-ctx-value tabular-nums",
              ctx.gamma_flip_dist_pts >= 0 ? "text-bull" : "text-bear"
            )}
          >
            {ctx.gamma_flip_dist_pts > 0 ? "+" : ""}
            {ctx.gamma_flip_dist_pts}
          </span>
        </div>
      )}

      {ctx.max_pain_dist_pts != null && (
        <div className="spx-play-ctx-chip" title="Distance to max pain">
          <span className="spx-play-ctx-label">Max pain</span>
          <span className="spx-play-ctx-value tabular-nums">
            {ctx.max_pain_dist_pts > 0 ? "+" : ""}
            {ctx.max_pain_dist_pts}
          </span>
        </div>
      )}

      {ctx.suggested_strike != null && ctx.suggested_option_type && (
        <div className="spx-play-ctx-chip" title="Suggested 0DTE strike from GEX ladder">
          <span className="spx-play-ctx-label">Strike</span>
          <span className="spx-play-ctx-value tabular-nums text-sky-200">
            {ctx.suggested_strike}
            {ctx.suggested_option_type === "call" ? "C" : "P"}
          </span>
        </div>
      )}
    </div>
  );
}
