"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Badge } from "@/components/ui";
import type { PlaybookPlay, PlayMorningStatus } from "@/features/nighthawk/lib/types";
import { formatPremiumCapLabel } from "@/features/nighthawk/lib/play-constraints";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";
import { formatCheckedAtEt, isMorningConfirmStale } from "@/features/nighthawk/lib/morning-confirm-verdict";

// PR-N12: rebuilt to the desk grammar the 0DTE pane (ZeroDteBoard) established —
// mono uppercase section labels, chip stacks, t-num money values, expandable
// evidence — replacing the old full-height slot rows. Every rendered value binds
// to a real PlaybookPlay payload field; nothing is invented client-side.

type PlaybookPlayRowProps = {
  rank: number;
  play: PlaybookPlay;
  morningConfirm?: PlayMorningStatus;
  /** ISO timestamp the morning-confirm cron computed `morningConfirm` — a one-time
   *  pre-market snapshot (see morning-confirm-verdict.ts). Undefined on older cached
   *  payloads; the badge just omits the "as of" qualifier in that case. */
  morningConfirmCheckedAt?: string;
  /** Opens the Hawk Intel briefing modal (PlayDetailModal). */
  onSelect?: () => void;
};

export function morningBadgeLabel(status: PlayMorningStatus["status"]): string {
  if (status === "CONFIRMED") return "Confirmed";
  if (status === "DEGRADED") return "Degraded";
  // UNVERIFIED = the desk could not run its pre-market checks (data unreachable) —
  // must not fall through to "Invalidated" (which would read as an adverse verdict).
  if (status === "UNVERIFIED") return "Unverified";
  return "Invalidated";
}

/** Desk chip tones per verdict: CONFIRMED green, DEGRADED amber, INVALIDATED red,
 *  UNVERIFIED neutral sky (a statement about the check, not the play). */
const MORNING_CHIP_TONE: Record<PlayMorningStatus["status"], string> = {
  CONFIRMED: "border-bull/35 bg-bull/10 text-bull",
  DEGRADED: "border-gold/35 bg-gold/10 text-gold",
  INVALIDATED: "border-bear/40 bg-bear/10 text-bear",
  UNVERIFIED: "border-sky-300/25 bg-sky-300/[0.05] text-sky-300/80",
};

/** Unrounded-float guard: scores are integers by contract, but degraded/legacy
 *  sources have served raw floats (systemic audit finding) — always round. */
export function fmtScore(raw: number | null | undefined): string {
  if (raw == null || !Number.isFinite(raw)) return "—";
  return String(Math.round(raw));
}

export function fmtIvRank(raw: number): string {
  const n = raw <= 1 && raw >= 0 ? raw * 100 : raw;
  const clamped = Math.min(100, Math.max(0, n));
  return `${Math.round(clamped)}%`;
}

function convictionTone(conviction: string): "bull" | "sky" | "neutral" {
  const c = conviction.trim().toUpperCase();
  if (c === "A+" || c === "A") return "bull";
  if (c === "B") return "sky";
  return "neutral";
}

/** Mono uppercase micro-label — the 0DTE pane's section-label grammar. */
function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">{children}</p>
  );
}

function LevelCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-sky-300/50">{label}</p>
      <p className="t-num text-[12px] font-semibold leading-tight text-white">{value}</p>
    </div>
  );
}

/** One payload-backed stat chip; renders nothing when the field is absent. */
function StatChip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-md border border-sky-300/20 bg-sky-300/[0.04] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-sky-200/85"
    >
      <span className="text-sky-300/50">{label}</span> {value}
    </span>
  );
}

/** Expanded per-play depth — ONLY fields the payload actually carries (key signal,
 *  risk note, score/streak/IV-rank stats, premium math, play type). */
function PlayRowDetail({ play, onSelect }: { play: PlaybookPlay; onSelect?: () => void }) {
  const showKeySignal = Boolean(play.key_signal?.trim()) && play.key_signal !== play.thesis;
  return (
    <div className="space-y-3 border-t border-white/[0.06] px-4 py-3">
      {showKeySignal && (
        <div>
          <MicroLabel>Key signal</MicroLabel>
          <p className="mt-1 text-[11px] leading-snug text-sky-200/85">{play.key_signal}</p>
        </div>
      )}

      <div>
        <MicroLabel>Score components</MicroLabel>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <StatChip label="Score" value={fmtScore(play.score)} />
          {play.flow_streak_days != null && (
            <StatChip
              label="Flow streak"
              value={`${Math.round(play.flow_streak_days)}d`}
              title="Consecutive sessions of one-sided flow in this name"
            />
          )}
          {play.iv_rank != null && <StatChip label="IV rank" value={fmtIvRank(play.iv_rank)} />}
          {play.entry_premium != null && (
            <StatChip label="Entry prem" value={`$${play.entry_premium.toFixed(2)}`} />
          )}
          {play.entry_cost_per_contract != null && (
            <StatChip
              label="Per lot"
              value={`$${Math.round(play.entry_cost_per_contract).toLocaleString()}`}
            />
          )}
          {play.play_type && <StatChip label="Type" value={play.play_type} />}
        </div>
      </div>

      {play.risk_note && (
        <div>
          <MicroLabel>Risk</MicroLabel>
          <p className="mt-1 text-[11px] leading-snug text-sky-200/85">{play.risk_note}</p>
        </div>
      )}

      {onSelect && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSelect}
            className="rounded-lg border border-cyan-400/30 bg-cyan-400/[0.08] px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan-300 transition-colors hover:bg-cyan-400/[0.16] hover:text-cyan-200"
          >
            Hawk Intel briefing ↗
          </button>
        </div>
      )}
    </div>
  );
}

export function PlaybookPlayRow({
  rank,
  play,
  morningConfirm,
  morningConfirmCheckedAt,
  onSelect,
}: PlaybookPlayRowProps) {
  const [open, setOpen] = useState(false);
  const dir = play.direction?.toUpperCase() ?? "";
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
  const isPulled = Boolean(play.pulled);
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
        "rounded-xl border border-white/[0.08] bg-white/[0.02] transition-colors",
        // Direction reads as a left accent — same silhouette as the 0DTE cards' tone edges.
        isBull && "border-l-2 border-l-bull/60",
        isBear && "border-l-2 border-l-bear/60",
        !isBull && !isBear && "border-l-2 border-l-sky-400/40",
        // Pulled: de-emphasize the whole card — the levels below are additionally
        // struck through so a screenshot can't read as an actionable setup.
        isPulled && "opacity-60",
        open ? "bg-white/[0.03]" : "hover:bg-white/[0.03]"
      )}
    >
      <button
        type="button"
        className="block w-full cursor-pointer px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Play ${rank}: ${play.ticker} ${play.direction} — expand details`}
      >
        {/* identity row: rank · ticker · direction · conviction · pulled · morning verdict · score */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.03] font-mono text-[11px] font-bold tabular-nums text-sky-300/80"
          >
            {rank}
          </span>
          <span className="t-num text-[15px] font-bold text-white">{play.ticker}</span>
          <Badge tone={isBull ? "bull" : isBear ? "bear" : "neutral"} size="sm">
            {play.direction}
          </Badge>
          {play.conviction && (
            <Badge tone={convictionTone(play.conviction)} size="sm" title={`Conviction ${play.conviction}`}>
              {play.conviction}
            </Badge>
          )}
          {isPulled && (
            <Badge
              tone="bear"
              size="sm"
              className="font-bold"
              title={play.pulled_reason ?? "Pulled pre-open by the morning confirmation check"}
            >
              Pulled
            </Badge>
          )}
          {morningConfirm && (
            <span
              className={clsx(
                "rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]",
                MORNING_CHIP_TONE[morningConfirm.status],
                // Verdicts are one-time pre-market snapshots — mute once old enough that
                // full confidence would read as a live status (title keeps the exact time).
                morningConfirmStale && "border-dashed opacity-55"
              )}
              title={morningConfirmTitle}
            >
              {morningBadgeLabel(morningConfirm.status)}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/40">score</span>
            <span className="t-num text-[12px] font-bold text-sky-200/85">{fmtScore(play.score)}</span>
            <span className={clsx("inline-block text-sky-300/40 transition-transform", open && "rotate-90")}>
              ›
            </span>
          </span>
        </div>

        {isPulled && (
          <p className="mt-2 font-mono text-[11px] leading-snug text-bear" role="status">
            {play.pulled_reason ?? "Pulled pre-open by the morning confirmation check"}
          </p>
        )}

        {/* plan line: entry band · target · stop — struck + dimmed when pulled */}
        <div
          className={clsx(
            "mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3",
            isPulled && "line-through opacity-70"
          )}
        >
          <LevelCell label="Entry" value={play.entry_range} />
          <LevelCell label="Target" value={play.target} />
          <LevelCell label="Stop" value={play.stop} />
        </div>

        {/* contract line */}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-sky-300/50">Contract</span>
          <span className={clsx("t-num min-w-0 text-[11px] leading-snug text-cyan-300/90", isPulled && "line-through")}>
            {play.options_play}
          </span>
          <span
            className="rounded-md border border-gold/25 bg-gold/[0.06] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-gold/95"
            title={`Desk cap: max $${MAX_OPTION_PREMIUM_PER_SHARE}/share entry premium`}
          >
            {formatPremiumCapLabel(play.entry_premium ?? null) ?? `≤$${MAX_OPTION_PREMIUM_PER_SHARE}`}
          </span>
        </div>

        {/* thesis */}
        <p className="mt-2 text-[12px] leading-snug text-sky-200/85">{play.thesis || play.key_signal}</p>

        {!open && (
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/35">
            expand for signal · risk · score components
          </p>
        )}
      </button>
      {open && <PlayRowDetail play={play} onSelect={onSelect} />}
    </article>
  );
}
