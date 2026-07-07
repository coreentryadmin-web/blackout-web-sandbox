"use client";

import { clsx } from "clsx";
import type { HuntPlay } from "@/features/nighthawk/lib/types";

type DayTradeSignalCardProps = {
  play: HuntPlay;
  rank: number;
  selected?: boolean;
  onSelect?: () => void;
};

function directionTone(direction: string) {
  const d = direction.toUpperCase();
  if (d.includes("LONG") || d.includes("BULL") || d.includes("CALL")) return "bull";
  if (d.includes("SHORT") || d.includes("BEAR") || d.includes("PUT")) return "bear";
  return "neutral";
}

export function DayTradeSignalCard({ play, rank, selected, onSelect }: DayTradeSignalCardProps) {
  const tone = directionTone(play.direction);

  return (
    <article
      className={clsx(
        "dayhawk-signal-card",
        `dayhawk-signal-card-${tone}`,
        selected && "dayhawk-signal-card-selected",
        onSelect && "dayhawk-signal-card-clickable"
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
    >
      <header className="dayhawk-signal-card-head">
        <span className="dayhawk-signal-rank">#{rank}</span>
        <div className="dayhawk-signal-identity">
          <span className="dayhawk-signal-ticker">{play.ticker}</span>
          <span className={clsx("dayhawk-signal-direction", `dayhawk-signal-direction-${tone}`)}>
            {play.direction}
          </span>
        </div>
        <div className="dayhawk-signal-badges">
          {play.spx_aligned === true && (
            <span className="dayhawk-signal-badge dayhawk-signal-badge-spx">SPX ✓</span>
          )}
          {play.spx_aligned === false && (
            <span className="dayhawk-signal-badge dayhawk-signal-badge-warn">SPX ✗</span>
          )}
          <span className="dayhawk-signal-badge dayhawk-signal-badge-phase">
            {play.phase ?? "CANDIDATE"}
          </span>
          <span className="dayhawk-signal-score">{play.score != null ? play.score : "—"}</span>
        </div>
      </header>

      <p className="dayhawk-signal-thesis">{play.thesis}</p>

      <div className="dayhawk-signal-levels">
        <div>
          <em>Entry</em>
          <span>{play.entry}</span>
        </div>
        <div>
          <em>Target</em>
          <span>{play.target}</span>
        </div>
        <div>
          <em>Stop</em>
          <span>{play.stop}</span>
        </div>
      </div>

      <p className="dayhawk-signal-contract">{play.contract}</p>

      <p className="font-mono text-[10px] text-sky-300/60 mt-2">
        Educational. Not advice. Every trade is your own decision.
      </p>
    </article>
  );
}
