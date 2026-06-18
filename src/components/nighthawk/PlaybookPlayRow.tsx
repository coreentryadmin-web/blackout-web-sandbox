"use client";

import { clsx } from "clsx";
import type { PlaybookPlay } from "@/lib/nighthawk/types";

type PlaybookPlayRowProps = {
  rank: number;
  play?: PlaybookPlay;
  empty?: boolean;
};

export function PlaybookPlayRow({ rank, play, empty }: PlaybookPlayRowProps) {
  const isBull = play?.direction?.toLowerCase().includes("bull") || play?.direction === "LONG";

  return (
    <article
      className={clsx(
        "nighthawk-play-row",
        empty && "nighthawk-play-row-empty",
        !empty && isBull && "nighthawk-play-row-bull",
        !empty && !isBull && "nighthawk-play-row-bear"
      )}
    >
      <div className="nighthawk-play-rank">{rank}</div>

      {empty || !play ? (
        <div className="nighthawk-play-body nighthawk-play-body-empty">
          <p className="nighthawk-play-empty-title">Slot open</p>
          <p className="nighthawk-play-empty-copy">
            Playbook auto-fills after the evening scan · post-close ET
          </p>
        </div>
      ) : (
        <div className="nighthawk-play-body">
          <div className="nighthawk-play-head">
            <div className="nighthawk-play-ticker-wrap">
              <span className="nighthawk-play-ticker">{play.ticker}</span>
              <span
                className={clsx(
                  "nighthawk-play-direction",
                  isBull ? "nighthawk-play-direction-bull" : "nighthawk-play-direction-bear"
                )}
              >
                {play.direction}
              </span>
              <span className="nighthawk-play-conviction">{play.conviction}</span>
            </div>
            <div className="nighthawk-play-stats">
              <span>Score {play.score}</span>
              {play.flow_streak_days != null && <span>Streak {play.flow_streak_days}d</span>}
              {play.iv_rank != null && <span>IV {play.iv_rank}</span>}
            </div>
          </div>

          <p className="nighthawk-play-thesis">{play.thesis || play.key_signal}</p>

          <div className="nighthawk-play-levels">
            <span>
              <em>Entry</em> {play.entry_range}
            </span>
            <span>
              <em>Target</em> {play.target}
            </span>
            <span>
              <em>Stop</em> {play.stop}
            </span>
            <span className="nighthawk-play-contract">
              <em>Contract</em> {play.options_play}
            </span>
          </div>
        </div>
      )}
    </article>
  );
}
