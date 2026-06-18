"use client";

import { clsx } from "clsx";
import type { PlaybookPlay } from "@/lib/nighthawk/types";
import { formatPremiumCapLabel } from "@/lib/nighthawk/play-constraints";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/lib/nighthawk/constants";

type PlaybookPlayRowProps = {
  rank: number;
  play?: PlaybookPlay;
  empty?: boolean;
  onSelect?: () => void;
};

export function PlaybookPlayRow({ rank, play, empty, onSelect }: PlaybookPlayRowProps) {
  const dir = play?.direction?.toUpperCase() ?? "";
  const isBull = dir.includes("BULL") || dir === "LONG" || dir.includes("CALL");
  const isBear = dir.includes("BEAR") || dir === "SHORT" || dir.includes("PUT");

  return (
    <article
      className={clsx(
        "nighthawk-play-row",
        empty && "nighthawk-play-row-empty",
        !empty && isBull && "nighthawk-play-row-bull",
        !empty && isBear && "nighthawk-play-row-bear",
        !empty && !isBull && !isBear && "nighthawk-play-row-neutral",
        onSelect && "nighthawk-play-row-clickable"
      )}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? `Open briefing for ${play?.ticker} rank ${rank}` : undefined}
    >
      <div className="nighthawk-play-rank" aria-label={`Rank ${rank}`}>
        <span className="nighthawk-play-rank-num">{rank}</span>
      </div>

      {empty || !play ? (
        <div className="nighthawk-play-body nighthawk-play-body-empty">
          <p className="nighthawk-play-empty-title">Slot open</p>
          <p className="nighthawk-play-empty-copy">
            Playbook auto-fills after the evening scan · post-close ET
          </p>
        </div>
      ) : (
        <div className="nighthawk-play-body">
          <div className="nighthawk-play-top">
            <div className="nighthawk-play-identity">
              <span className="nighthawk-play-ticker">{play.ticker}</span>
              <span
                className={clsx(
                  "nighthawk-play-direction",
                  isBull && "nighthawk-play-direction-bull",
                  isBear && "nighthawk-play-direction-bear",
                  !isBull && !isBear && "nighthawk-play-direction-neutral"
                )}
              >
                {play.direction}
              </span>
              <span className="nighthawk-play-conviction">{play.conviction}</span>
              {play.play_type !== "stock" && (
                <span className="nighthawk-play-type">{play.play_type}</span>
              )}
            </div>

            <div className="nighthawk-play-stats">
              <span className="nighthawk-play-stat">
                <em>Score</em> {play.score}
              </span>
              {play.flow_streak_days != null && (
                <span className="nighthawk-play-stat">
                  <em>Streak</em> {play.flow_streak_days}d
                </span>
              )}
              {play.iv_rank != null && (
                <span className="nighthawk-play-stat">
                  <em>IV</em> {play.iv_rank}
                </span>
              )}
              <span
                className="nighthawk-play-prem-cap"
                title={`Max $${MAX_OPTION_PREMIUM_PER_SHARE}/share`}
              >
                {formatPremiumCapLabel(play.entry_premium ?? null) ??
                  `≤$${MAX_OPTION_PREMIUM_PER_SHARE} prem`}
              </span>
            </div>
          </div>

          <p className="nighthawk-play-thesis">{play.thesis || play.key_signal}</p>

          {play.key_signal && play.thesis && play.key_signal !== play.thesis && (
            <p className="nighthawk-play-signal">
              <em>Signal</em> {play.key_signal}
            </p>
          )}

          <div className="nighthawk-play-levels">
            <div className="nighthawk-play-level">
              <span className="nighthawk-play-level-label">Entry</span>
              <span className="nighthawk-play-level-value">{play.entry_range}</span>
            </div>
            <div className="nighthawk-play-level">
              <span className="nighthawk-play-level-label">Target</span>
              <span className="nighthawk-play-level-value">{play.target}</span>
            </div>
            <div className="nighthawk-play-level">
              <span className="nighthawk-play-level-label">Stop</span>
              <span className="nighthawk-play-level-value">{play.stop}</span>
            </div>
          </div>

          <div className="nighthawk-play-contract-row">
            <span className="nighthawk-play-level-label">Contract</span>
            <span className="nighthawk-play-contract">{play.options_play}</span>
          </div>

          {play.risk_note && (
            <p className="nighthawk-play-risk">
              <em>Risk</em> {play.risk_note}
            </p>
          )}

          {onSelect && <span className="nighthawk-play-open-hint">Hawk Intel →</span>}
        </div>
      )}
    </article>
  );
}
