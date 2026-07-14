"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { PlaybookPlay, PlayMorningStatus } from "@/features/nighthawk/lib/types";
import { formatPremiumCapLabel } from "@/features/nighthawk/lib/play-constraints";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";
import { formatCheckedAtEt, isMorningConfirmStale } from "@/features/nighthawk/lib/morning-confirm-verdict";

type PlaybookPlayRowProps = {
  rank: number;
  play?: PlaybookPlay;
  empty?: boolean;
  emptyTitle?: string;
  emptyCopy?: string;
  morningConfirm?: PlayMorningStatus;
  /** ISO timestamp the morning-confirm cron computed `morningConfirm` — a one-time
   *  pre-market snapshot (see morning-confirm-verdict.ts). Undefined on older cached
   *  payloads; the badge just omits the "as of" qualifier in that case. */
  morningConfirmCheckedAt?: string;
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
  morningConfirmCheckedAt,
  onSelect,
}: PlaybookPlayRowProps) {
  const dir = play?.direction?.toUpperCase() ?? "";
  const isBull = dir.includes("BULL") || dir === "LONG" || dir.includes("CALL");
  const isBear = dir.includes("BEAR") || dir === "SHORT" || dir.includes("PUT");
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const morningConfirmStale =
    nowMs != null && isMorningConfirmStale(morningConfirmCheckedAt, nowMs);
  // PR-N4: the server-side pull latch (an INVALIDATED morning verdict). Stronger than the
  // Redis-badge "Invalidated" label — the play is no longer actionable and is presented as
  // PULLED with its reason, but stays visible at its published rank (honesty: pulled plays
  // are never hidden; their grade is counterfactual-only in the record).
  const isPulled = Boolean(play?.pulled);
  const morningConfirmTitle = morningConfirm
    ? morningConfirmCheckedAt
      ? `${morningConfirm.reason} — checked ${formatCheckedAtEt(morningConfirmCheckedAt)}${
          morningConfirmStale ? " (pre-market snapshot, may be outdated)" : ""
        }`
      : morningConfirm.reason
    : undefined;

  return (
    <article
      className={clsx(
        "nighthawk-play-row",
        empty && "nighthawk-play-row-empty",
        !empty && isBull && "nighthawk-play-row-bull",
        !empty && isBear && "nighthawk-play-row-bear",
        !empty && !isBull && !isBear && "nighthawk-play-row-neutral",
        // Pulled: de-emphasize the whole card — the levels below are additionally
        // struck through so a screenshot can't read as an actionable setup.
        !empty && isPulled && "nighthawk-play-row-pulled opacity-60",
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
              {isPulled && (
                <span
                  className="nighthawk-play-pulled-badge rounded border border-rose-400/50 bg-rose-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-rose-300"
                  title={play.pulled_reason ?? "Pulled pre-open by the morning confirmation check"}
                >
                  Pulled
                </span>
              )}
              {morningConfirm && (
                <span
                  className={clsx(
                    "nighthawk-play-morning-badge",
                    morningBadgeClass(morningConfirm.status),
                    morningConfirmStale && "nighthawk-play-morning-stale"
                  )}
                  title={morningConfirmTitle}
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

          {isPulled && (
            <p className="nighthawk-play-pulled-reason font-mono text-xs text-rose-300" role="status">
              {play.pulled_reason ?? "Pulled pre-open by the morning confirmation check"}
            </p>
          )}

          <p className="nighthawk-play-thesis">{play.thesis || play.key_signal}</p>

          <div className={clsx("nighthawk-play-levels", isPulled && "line-through")}>
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
