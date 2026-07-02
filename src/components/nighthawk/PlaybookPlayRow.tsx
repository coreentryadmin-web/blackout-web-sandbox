"use client";

import { clsx } from "clsx";
import type { PlaybookPlay, PlayMorningStatus } from "@/lib/nighthawk/types";
import { formatPremiumCapLabel } from "@/lib/nighthawk/play-constraints";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/lib/nighthawk/constants";

type PlaybookPlayRowProps = {
  rank: number;
  play?: PlaybookPlay;
  empty?: boolean;
  emptyTitle?: string;
  emptyCopy?: string;
  morningConfirm?: PlayMorningStatus;
  onSelect?: () => void;
};

function morningBadgeLabel(status: PlayMorningStatus["status"]): string {
  if (status === "CONFIRMED") return "Confirmed";
  if (status === "DEGRADED") return "Degraded";
  // UNVERIFIED = the desk could not run its pre-market checks (data unreachable) —
  // must not fall through to "Invalidated" (which would read as an adverse verdict).
  if (status === "UNVERIFIED") return "Unverified";
  return "Invalidated";
}

function morningBadgeClass(status: PlayMorningStatus["status"]): string {
  if (status === "CONFIRMED") return "nighthawk-play-morning-confirmed";
  if (status === "DEGRADED") return "nighthawk-play-morning-degraded";
  if (status === "UNVERIFIED") return "nighthawk-play-morning-unverified";
  return "nighthawk-play-morning-invalidated";
}

function fmtIvRank(raw: number): string {
  const n = raw <= 1 && raw >= 0 ? raw * 100 : raw;
  const clamped = Math.min(100, Math.max(0, n));
  return `${Math.round(clamped)}%`;
}

export function PlaybookPlayRow({
  rank,
  play,
  empty,
  emptyTitle,
  emptyCopy,
  morningConfirm,
  onSelect,
}: PlaybookPlayRowProps) {
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
      aria-label={onSelect ? `Open Hawk Intel briefing for ${play?.ticker}, rank ${rank}` : undefined}
    >
      <div className="nighthawk-play-rank" aria-hidden="true">
        <span className="nighthawk-play-rank-num">{rank}</span>
      </div>

      {empty || !play ? (
        <div className="nighthawk-play-body nighthawk-play-body-empty">
          <p className="nighthawk-play-empty-title">{emptyTitle ?? "Open slot"}</p>
          <p className="nighthawk-play-empty-copy">
            {emptyCopy ?? "Fills after the evening scan · ~5:30 PM ET"}
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
              {play.conviction && (
                <span className="nighthawk-play-conviction">{play.conviction}</span>
              )}
              {morningConfirm && (
                <span
                  className={clsx("nighthawk-play-morning-badge", morningBadgeClass(morningConfirm.status))}
                  title={morningConfirm.reason}
                >
                  {morningBadgeLabel(morningConfirm.status)}
                </span>
              )}
            </div>

            <div className="nighthawk-play-stats">
              <span className="nighthawk-play-stat-pill">
                Score <strong>{play.score != null ? play.score : "—"}</strong>
              </span>
              {play.flow_streak_days != null && (
                <span className="nighthawk-play-stat-pill">
                  Streak <strong>{play.flow_streak_days}d</strong>
                </span>
              )}
              {play.iv_rank != null && (
                <span className="nighthawk-play-stat-pill">
                  IV Rank <strong>{fmtIvRank(play.iv_rank)}</strong>
                </span>
              )}
              <span className="nighthawk-play-prem-cap" title={`Max $${MAX_OPTION_PREMIUM_PER_SHARE}/share`}>
                {formatPremiumCapLabel(play.entry_premium ?? null) ?? `≤$${MAX_OPTION_PREMIUM_PER_SHARE}`}
              </span>
            </div>
          </div>

          <p className="nighthawk-play-thesis">{play.thesis || play.key_signal}</p>

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
              <span className="nighthawk-play-risk-label">Risk</span> {play.risk_note}
            </p>
          )}

          {onSelect && <span className="nighthawk-play-open-hint">Hawk Intel →</span>}
        </div>
      )}
    </article>
  );
}
