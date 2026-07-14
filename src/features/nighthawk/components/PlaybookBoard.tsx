"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Badge, EmptyState, FreshnessChip, Skeleton } from "@/components/ui";
import { PlaybookPlayRow } from "./PlaybookPlayRow";
import { TRACK_RECORD_MIN_SAMPLE } from "@/components/track-record/format";
import type {
  NightHawkEdition,
  NightHawkRecordResponse,
  PlaybookPlay,
  PlayMorningStatus,
} from "@/features/nighthawk/lib/types";

// PR-N12: professional-grade rebuild of the playbook column in the 0DTE pane's desk
// grammar (see ZeroDteBoard.tsx): one compact edition-header strip, market context as
// a label:value data grid (prose demoted to a collapsed disclosure), evidence-first
// play cards, and ONE honest empty state on zero-play nights — the five repeated
// "Hawk is circling" placeholder slots are gone; numbered cards render only for
// actual plays. Every value binds to a real payload field.

type PlaybookBoardProps = {
  edition: NightHawkEdition | undefined;
  loading?: boolean;
  editionError?: string;
  onPlaySelect?: (play: PlaybookPlay) => void;
  confirmByTicker?: Map<string, PlayMorningStatus>;
  playStatusAvailable?: boolean;
  /** ISO timestamp the morning-confirm cron computed these verdicts — a one-time
   *  pre-market snapshot, not live. Passed through so the badge can show its age. */
  morningConfirmCheckedAt?: string;
  record?: NightHawkRecordResponse;
  recordLoading?: boolean;
};

export function formatEditionDate(editionFor: string | null | undefined): string | null {
  if (!editionFor) return null;
  const iso = String(editionFor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function editionHasRecapContent(edition: NightHawkEdition | undefined): boolean {
  if (!edition) return false;
  if (edition.recap_headline?.trim()) return true;
  if (edition.recap_summary?.trim()) return true;
  if (edition.market_recap && Object.keys(edition.market_recap).length > 0) return true;
  return false;
}

// ── edition status pill (one word, desk tones) ────────────────────────────────────

export type EditionStatus = {
  label: string;
  tone: "bull" | "bear" | "sky" | "neutral" | "accent";
  dot: boolean;
};

/** Pure: one status word for the header strip. Order matters — syncing beats
 *  everything; stale/degraded beat LIVE (never assert a green edition over
 *  prior/fallback data); recap-only is its own honest state; else BUILDING. */
export function resolveEditionStatus(args: {
  loading: boolean;
  hasPlays: boolean;
  isStale: boolean;
  isDegraded: boolean;
  recapState: boolean;
}): EditionStatus {
  if (args.loading) return { label: "Syncing", tone: "sky", dot: false };
  if (args.isStale) return { label: "Prior edition", tone: "neutral", dot: false };
  if (args.isDegraded) return { label: "Legacy source", tone: "neutral", dot: false };
  if (args.hasPlays) return { label: "Live", tone: "bull", dot: true };
  if (args.recapState) return { label: "Recap only", tone: "sky", dot: true };
  return { label: "Building", tone: "sky", dot: false };
}

// ── market context: label:value grid from the market_recap payload strings ─────────

export type MarketContextItem = { label: string; value: string; wide?: boolean };

/** Pure: pick the compact context strings the edition builder actually publishes
 *  (format.ts buildMarketRecap → tide / spx_vix / sector_strength / sector_weakness /
 *  catalysts). Only non-empty strings render; nothing is synthesized. */
export function marketContextItems(recap: Record<string, unknown>): MarketContextItem[] {
  const items: MarketContextItem[] = [];
  const push = (label: string, v: unknown, wide?: boolean) => {
    if (typeof v === "string" && v.trim()) items.push({ label, value: v, wide });
  };
  push("Tide", recap.tide, true);
  push("SPX · VIX", recap.spx_vix, true);
  push("Leaders", recap.sector_strength);
  push("Laggards", recap.sector_weakness);
  push("Catalysts", recap.catalysts, true);
  return items;
}

function MarketContextGrid({ recap }: { recap: Record<string, unknown> }) {
  const items = marketContextItems(recap);
  if (!items.length) return null;
  return (
    <div
      className="shrink-0 border-b border-white/[0.06] px-4 py-2.5"
      role="region"
      aria-label="Market context"
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
        Market context
      </p>
      <div className="mt-1.5 grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.label}
            className={clsx("flex min-w-0 items-baseline gap-2", item.wide && "sm:col-span-2")}
          >
            <span className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-300/70">
              {item.label}
            </span>
            <span className="t-num min-w-0 flex-1 text-[11px] leading-snug text-sky-200/85">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── hawk record chip (compact, LOW-N aware) ────────────────────────────────────────

/** Compact header chip from the same data source HawkRecordStrip reads
 *  (NightHawkRecordResponse + the shared TRACK_RECORD_MIN_SAMPLE disclosure gate).
 *  Below the minimum sample the chip is an amber LOW-N marker — same honesty
 *  grammar as the 0DTE pane — never a confident tiny-sample win rate. */
function RecordChip({
  record,
  loading,
}: {
  record: NightHawkRecordResponse | undefined;
  loading?: boolean;
}) {
  if (loading && !record) return null;
  const resolved = record?.total_resolved ?? 0;
  if (!record?.available || resolved < TRACK_RECORD_MIN_SAMPLE) {
    return (
      <span
        className="rounded-md border border-gold/35 bg-gold/[0.08] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-gold"
        title={`Building track record — ${resolved}/${TRACK_RECORD_MIN_SAMPLE} plays resolved${
          record?.pending_count ? ` · ${record.pending_count} pending` : ""
        }. Ratio stats unlock at the shared minimum sample.`}
      >
        record {resolved}/{TRACK_RECORD_MIN_SAMPLE} · low n
      </span>
    );
  }
  return (
    <span
      className="rounded-md border border-sky-300/25 bg-sky-300/[0.05] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-sky-300"
      title={`${record.window_days}d window · ${record.total_resolved} resolved · target hit ${Math.round(
        record.win_rate_pct
      )}% · profitable ${Math.round(record.profitable_rate_pct)}% · avg ${
        record.avg_return_pct >= 0 ? "+" : ""
      }${Math.round(record.avg_return_pct)}%`}
    >
      {record.total_resolved} resolved · {Math.round(record.win_rate_pct)}% WR
    </span>
  );
}

// ── empty state (ONE honest block — no repeated placeholder slots) ─────────────────

function PlaybookEmptyState({
  recapState,
  editionLabel,
  headline,
}: {
  /** True when a real edition published with zero plays (recap-only night). */
  recapState: boolean;
  editionLabel: string | null;
  headline: string | null;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-4" role="status">
      <EmptyState
        className="w-full max-w-md"
        icon="◎"
        title={recapState ? "No plays cleared tonight's gates" : "Playbook publishes after the close"}
        description={
          recapState
            ? `Recap only${editionLabel ? ` for ${editionLabel}` : ""} — zero ranked setups survived the funnel.${
                headline ? ` ${headline}.` : ""
              } Ranked plays return when a setup clears the gates.`
            : "Five ranked setups land here automatically after the evening scan · ~5:30 PM ET."
        }
      />
    </div>
  );
}

// ── board ──────────────────────────────────────────────────────────────────────────

export function PlaybookBoard({
  edition,
  loading,
  editionError,
  onPlaySelect,
  confirmByTicker,
  playStatusAvailable,
  morningConfirmCheckedAt,
  record,
  recordLoading,
}: PlaybookBoardProps) {
  const [recapOpen, setRecapOpen] = useState(false);
  const plays = edition?.plays ?? [];
  const hasPlays = plays.length > 0;
  const hasRecap = editionHasRecapContent(edition);
  const showRecapState = (Boolean(edition?.available) || hasRecap) && !hasPlays;
  const editionLabel = formatEditionDate(edition?.edition_for);
  const isStale = Boolean(edition?.stale);
  const isDegraded = Boolean(edition?.degraded);
  const carryUntilClose = Boolean(edition?.carry_until_close);
  const servedForLabel = formatEditionDate(edition?.served_for ?? edition?.edition_for);
  const showFreshBadge = hasPlays && !isStale && !isDegraded;

  const status = resolveEditionStatus({
    loading: Boolean(loading),
    hasPlays,
    isStale,
    isDegraded,
    recapState: showRecapState,
  });

  const morningSummary = playStatusAvailable
    ? Array.from(confirmByTicker?.values() ?? []).reduce(
        (acc, p) => {
          if (p.status === "CONFIRMED") acc.confirmed += 1;
          else if (p.status === "DEGRADED") acc.degraded += 1;
          else if (p.status === "INVALIDATED") acc.invalidated += 1;
          else if (p.status === "UNVERIFIED") acc.unverified += 1;
          return acc;
        },
        { confirmed: 0, degraded: 0, invalidated: 0, unverified: 0 }
      )
    : null;

  const freshnessStatus = loading
    ? ("syncing" as const)
    : showFreshBadge || showRecapState
      ? ("live" as const)
      : isStale
        ? ("stale" as const)
        : ("offline" as const);

  return (
    <section
      key={`nh-board-${plays.length}`}
      className={`nighthawk-playbook${hasPlays && !isStale ? " vitals-nh-border-pulse" : ""}`}
    >
      {/* ── edition header: one compact strip — date · status · count · record ── */}
      <header className="shrink-0 border-b border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-gold/85">
              Night Hawk · Tonight&apos;s playbook
            </p>
            <h2 className="t-num text-[17px] font-bold leading-tight text-white">
              {editionLabel ? `For ${editionLabel}` : "Next session"}
            </h2>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {/* One status element, never two: a fresh playable edition gets the
                FreshnessChip (LIVE + publish age); every other state gets the word
                pill. Rendering both printed twin "LIVE" chips side by side. */}
            {showFreshBadge && edition?.published_at && !loading ? (
              <FreshnessChip status={freshnessStatus} asOf={new Date(edition.published_at)} />
            ) : (
              <Badge tone={status.tone} size="sm" dot={status.dot}>
                {status.label}
              </Badge>
            )}
            {hasPlays && (
              <span className="rounded-md border border-sky-300/25 bg-sky-300/[0.05] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] tabular-nums text-sky-300">
                {plays.length} {plays.length === 1 ? "play" : "plays"}
              </span>
            )}
            <RecordChip record={record} loading={recordLoading} />
          </div>
        </div>
        {edition?.recap_headline && (
          <p className="mt-1.5 truncate font-mono text-[11px] text-gold/80">{edition.recap_headline}</p>
        )}
      </header>

      {editionError && !edition && !loading && (
        <div
          className="m-3 rounded-lg border border-bear/40 bg-bear/[0.08] px-4 py-3 font-mono text-xs text-bear"
          role="alert"
        >
          {editionError}
        </div>
      )}

      {/* ── market context: tight data grid, not paragraphs ── */}
      {edition?.market_recap && typeof edition.market_recap === "object" && (
        <MarketContextGrid recap={edition.market_recap} />
      )}

      {/* ── pre-market verdict summary (real morning-confirm counts) ── */}
      {morningSummary && hasPlays && (
        <div
          className="flex shrink-0 flex-wrap items-baseline gap-x-2 border-b border-white/[0.06] px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-sky-300/80"
          role="status"
        >
          <span className="tracking-[0.16em] text-bull/90">Pre-market</span>
          <span className="tabular-nums normal-case">
            {morningSummary.confirmed} confirmed
            {morningSummary.degraded ? ` · ${morningSummary.degraded} degraded` : ""}
            {morningSummary.invalidated ? ` · ${morningSummary.invalidated} invalidated` : ""}
            {morningSummary.unverified ? ` · ${morningSummary.unverified} unverified` : ""}
          </span>
        </div>
      )}

      {/* ── honesty notices (stale / carry / degraded) ── */}
      {isStale && (
        <p
          className="shrink-0 border-b border-gold/20 bg-gold/[0.05] px-4 py-2 font-mono text-[11px] leading-relaxed text-gold"
          role="status"
        >
          Showing {servedForLabel ?? "the last published"} edition — tonight&apos;s playbook isn&apos;t
          published yet. Levels may no longer be current.
        </p>
      )}
      {carryUntilClose && (
        <p
          className="shrink-0 border-b border-white/[0.06] px-4 py-2 font-mono text-[11px] leading-relaxed text-sky-300/80"
          role="status"
        >
          Today&apos;s generated plays stay live until the session close. Tomorrow&apos;s board takes over after
          the cash close.
        </p>
      )}
      {isDegraded && (
        <p
          className="shrink-0 border-b border-gold/20 bg-gold/[0.05] px-4 py-2 font-mono text-[11px] leading-relaxed text-gold"
          role="status"
        >
          Served from a degraded fallback — treat as provisional until tonight&apos;s edition publishes.
        </p>
      )}

      {/* ── market recap prose: collapsed disclosure, default closed ── */}
      {edition?.recap_summary && (
        <div className="shrink-0 border-b border-white/[0.06]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80 transition-colors hover:text-cyan-200"
            onClick={() => setRecapOpen((o) => !o)}
            aria-expanded={recapOpen}
          >
            Market recap
            <span
              className={clsx("inline-block text-sky-300/40 transition-transform", recapOpen && "rotate-90")}
              aria-hidden="true"
            >
              ›
            </span>
          </button>
          {recapOpen && (
            <p className="px-4 pb-3 text-[12px] leading-relaxed text-sky-200/85">
              {edition.recap_summary}
            </p>
          )}
        </div>
      )}

      {/* ── plays: evidence-first cards, numbered only for ACTUAL plays ── */}
      {hasPlays ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {plays.map((play, i) => (
            <PlaybookPlayRow
              key={`${play.ticker}-${play.rank ?? i}`}
              rank={play.rank ?? i + 1}
              play={play}
              morningConfirm={confirmByTicker?.get(play.ticker.toUpperCase())}
              morningConfirmCheckedAt={morningConfirmCheckedAt}
              onSelect={onPlaySelect ? () => onPlaySelect(play) : undefined}
            />
          ))}
        </div>
      ) : loading && !edition ? (
        // First paint while the edition fetch is in flight — sweep placeholders,
        // not a premature "publishes after the close" claim.
        <div className="min-h-0 flex-1 space-y-2 p-3" role="status" aria-label="Loading edition">
          <Skeleton height={72} rounded="xl" />
          <Skeleton height={72} rounded="xl" />
          <Skeleton height={72} rounded="xl" />
        </div>
      ) : (
        <PlaybookEmptyState
          recapState={showRecapState}
          editionLabel={editionLabel}
          headline={edition?.recap_headline ?? null}
        />
      )}
    </section>
  );
}
