"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import {
  Badge,
  EmptyState,
  FreshnessChip,
  Panel,
  Skeleton,
  type FreshnessStatus,
} from "@/components/ui";
import { resolveFreshFindStatus, type EnrichedZeroDteSetup, type SessionHeat } from "@/lib/zerodte/board";
import { buildIntelNote, type IntelAction } from "@/lib/zerodte/intel";
import { capConvictionDisplay } from "@/lib/zerodte/conviction";
import { isZeroDteMarkStale, type ZeroDteMarkSource } from "@/lib/zerodte/marks-math";
import type { ZeroDteLiveMarkRow } from "@/lib/zerodte/live-marks";
import { etMinutesOf } from "@/lib/zerodte/plan";
import {
  evidenceRowParts,
  fmtLockRemaining,
  isCortexBlockCode,
  minutesUntilEtUnlock,
  readCortexView,
  readTierAssignment,
  reentryLockRemainingMs,
  resolveZeroDteReadiness,
  suggestedZeroDteSize,
  zeroDteGateLabel,
  type PaneCortexView,
} from "@/lib/zerodte/pane";
// Client-safe: tiers.ts is pure — its one import (./gates constants) reaches only
// modules already stubbed for the client bundle (next.config.mjs aliases ioredis
// to false, same isomorphic pattern as spx-desk-merge.ts).
import { displayTierFor, tierForSkip, type TierFactor, type ZeroDteTier } from "@/lib/zerodte/tiers";
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";
import { useZeroDteLiveMarks } from "@/features/nighthawk/hooks/useZeroDteLiveMarks";
import { shortMonthDay } from "@/lib/relative-time";

// ── Response shape (structural mirror of /api/market/zerodte/board) ──────────────

type NighthawkEcho = {
  edition_for: string;
  direction: string;
  conviction: string;
  outcome: string;
  score: number | null;
};

type LedgerRow = {
  ticker: string;
  direction: "long" | "short";
  score_max: number;
  spike: boolean;
  first_flagged_at: string;
  underlying_at_flag: number | null;
  top_strike: number | null;
  /** Contract expiry (YYYY-MM-DD) — additive (PR-D); absent on older payloads. */
  expiry?: string | null;
  conviction: string | null;
  entry_premium: number | null;
  flow_avg_fill: number | null;
  status: string | null;
  last_mark: number | null;
  live_pnl_pct: number | null;
  /** B-9: "stopped" pins live_pnl_pct to −50 server-side (frozen-mark fix). */
  closed_reason?: "stopped" | null;
  /** B-9: quote timestamp/provenance when the live-marks lane served last_mark. */
  mark_as_of?: string | null;
  mark_source?: ZeroDteMarkSource | null;
  move_pct: number | null;
  direction_hit: boolean | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  graded: boolean;
  /** BIE ecosystem echo: this ticker's most recent Night Hawk take, if any (a
   *  prior edition — today's Night Hawk names never reach this scanner). Null
   *  for the vast majority of rows; purely an annotation, never a gate. */
  nighthawk_echo: NighthawkEcho | null;
  /** Commit-time Cortex evidence blob (entry_context.cortex passthrough, #318) —
   *  opaque here; validated structurally by readCortexView. */
  cortex?: unknown;
  /** Commit-time merit tier blob (entry_context.tier passthrough, PR-F) — opaque
   *  here; validated structurally by readTierAssignment. */
  tier?: unknown;
};

/** G-5 session risk summary (additive, PR-D — zerodte-service's governor block). */
type BoardGovernor = {
  open_plans: Array<{ ticker: string; direction: "long" | "short" }>;
  max_concurrent: number;
  stops: Array<{ ticker: string; direction: "long" | "short"; at_ms: number | null }>;
  max_session_stops: number;
  halted: boolean;
  reentry_lock_ms: number;
};

type BoardResponse = {
  available: boolean;
  degraded?: boolean;
  as_of?: string;
  /** False when the scan's own upstream tape fetch failed and silently degraded to an
   *  empty read this cycle — distinguishes "genuinely quiet tape" from "the scan
   *  couldn't see the tape" for the freshness badge below. */
  upstream_ok?: boolean;
  session?: { date: string; trading_day: boolean; heat: SessionHeat };
  setups?: EnrichedZeroDteSetup[];
  ledger?: LedgerRow[];
  covered_elsewhere?: string[];
  governor?: BoardGovernor | null;
};

/** Pure: derives a real freshness status from the scan's own success signal + response
 *  age, instead of a hardcoded "live" literal. `staleAfterMs` defaults to 6x the board's
 *  10s active-session poll interval — enough slack for normal jitter, still short enough
 *  to flag a genuinely stuck feed well before a member would notice on their own. */
export function resolveZeroDteFreshness(
  upstreamOk: boolean | undefined,
  asOfMs: number,
  nowMs: number,
  staleAfterMs = 60_000
): FreshnessStatus {
  if (upstreamOk === false) return "offline";
  if (asOfMs > 0 && nowMs > 0 && nowMs - asOfMs > staleAfterMs) return "stale";
  return "live";
}

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" }).then((r) => r.json()) as Promise<BoardResponse>;

// ── formatting helpers ────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtStrike(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return "";
  }
}

/** Compact "8s" / "2m" age between an ISO instant and now — for mark freshness. */
function fmtAge(iso: string | null | undefined, nowMs: number): string {
  if (!iso || !(nowMs > 0)) return "";
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

function largoHref(ticker: string, contract: string, entry: string): string {
  const q = `Analyze the ${ticker} 0DTE play ${contract} (entry ${entry}). Is it still valid right now — hold, trim, or exit?`;
  return `/terminal?q=${encodeURIComponent(q)}`;
}

// ── merged play row (ledger = source of truth; fresh finds not yet persisted merge in) ──

type PlayRow = {
  ticker: string;
  direction: "long" | "short";
  strike: number | null;
  expiry: string | null;
  /** OPEN/HOLD/TRIM/CLOSED are LEDGER lifecycles (committed:true only). WATCH is a
   *  fresh, UNCOMMITTED candidate (never rendered as a position); SKIP is a refused
   *  find. The one-way commit door: a committed ticker is always presented from its
   *  ledger row, so no row can regress from OPEN back to WATCH/SKIP. */
  status: "OPEN" | "HOLD" | "TRIM" | "CLOSED" | "SKIP" | "WATCH";
  /** True for ledger-backed rows (a printed plan being managed to its exit);
   *  false for fresh finds the cron hasn't persisted yet. */
  committed: boolean;
  entry_premium: number | null;
  flow_avg_fill: number | null;
  conviction: string | null;
  last_mark: number | null;
  live_pnl_pct: number | null;
  closed_reason: "stopped" | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  first_flagged_at: string | null;
  score: number;
  spike: boolean;
  /** Full live find (evidence + plan) when this ticker is still in the top-10. */
  setup: EnrichedZeroDteSetup | null;
  /** Normalized Cortex evidence for the card. Committed rows prefer the ledger's
   *  pinned commit-time blob (what actually gated the money) over the setup's
   *  live assessment; fresh finds carry the live assessment. Null = no verdict
   *  on record → the card says so honestly, never fabricates a table. */
  cortex: PaneCortexView | null;
  /** Merit tier for the card's chip (PR-F). Committed rows carry the PINNED
   *  commit-time assignment (entry_context.tier passthrough — what the desk graded
   *  when the money moved, never a live re-derivation); refused fresh finds carry
   *  tierForSkip's F (each failing gate a "down" factor). Null = no tier on record
   *  (pre-wiring rows) or a WATCH candidate — an uncommitted, unrefused find is not
   *  a decision yet, so it gets NO grade rather than an invented provisional one. */
  tier: { tier: ZeroDteTier | "F"; factors: TierFactor[] } | null;
  /** BIE ecosystem echo — see LedgerRow. Null for fresh finds not yet persisted. */
  nighthawkEcho: NighthawkEcho | null;
  /** B-9 live-marks lane overlay (see overlayLiveMark): quote timestamp,
   *  provenance, and the stale-honesty flag for the mark/P&L cells. */
  mark_as_of?: string | null;
  mark_source?: ZeroDteMarkSource | null;
  mark_stale?: boolean;
  /** Two-sided quote behind the live mark, when the marks lane pushed one. */
  mark_bid?: number | null;
  mark_ask?: number | null;
};

/**
 * Overlay one live-marks SSE row onto a merged play row (B-9). Applies only to
 * live rows (OPEN/HOLD/TRIM) whose pushed mark is present; CLOSED and SKIP rows
 * keep their frozen/board numbers. live_pnl_pct comes PUSHED (computed once,
 * server-side, vs the pinned ledger entry) — never recomputed here. Staleness is
 * evaluated against the ticking clock so a dead stream dims within seconds even
 * with no new frames.
 */
export function overlayLiveMark(
  row: PlayRow,
  live: ZeroDteLiveMarkRow | undefined,
  nowMs: number
): PlayRow {
  const asOfMs = row.mark_as_of ? Date.parse(row.mark_as_of) : 0;
  const baseStale = row.mark_as_of != null ? isZeroDteMarkStale(asOfMs, nowMs) : undefined;
  if (row.status === "CLOSED" || row.status === "SKIP" || row.status === "WATCH")
    return { ...row, mark_stale: false };
  if (!live || live.mark == null) return { ...row, mark_stale: baseStale };
  const liveAsOfMs = live.mark_as_of ? Date.parse(live.mark_as_of) : 0;
  // Never let an older lane overwrite a fresher board value.
  if (asOfMs > 0 && liveAsOfMs > 0 && liveAsOfMs < asOfMs) return { ...row, mark_stale: baseStale };
  return {
    ...row,
    last_mark: live.mark,
    live_pnl_pct: live.live_pnl_pct ?? row.live_pnl_pct,
    mark_as_of: live.mark_as_of,
    mark_source: live.source,
    mark_bid: live.bid ?? null,
    mark_ask: live.ask ?? null,
    mark_stale: isZeroDteMarkStale(liveAsOfMs, nowMs),
  };
}

export function mergePlays(
  setups: EnrichedZeroDteSetup[],
  ledger: LedgerRow[],
  heatState: SessionHeat["state"] | undefined
): PlayRow[] {
  // Past the 15:00 ET cutoff no NEW play can open; after the close nothing is live.
  const sessionClosed = heatState === "CLOSED" || heatState === undefined;
  const byTicker = new Map(setups.map((s) => [s.ticker, s]));
  const rows: PlayRow[] = ledger.map((r) => ({
    ticker: r.ticker,
    direction: r.direction,
    strike: r.top_strike,
    expiry: r.expiry ?? byTicker.get(r.ticker)?.expiry ?? null,
    // Unknown/null status (e.g. a row the sync couldn't price) falls back by clock:
    // CLOSED once the session is over, HOLD while it's live — never a stale badge.
    status: (["OPEN", "HOLD", "TRIM", "CLOSED"].includes(r.status ?? "")
      ? r.status
      : sessionClosed
        ? "CLOSED"
        : "HOLD") as PlayRow["status"],
    committed: true,
    entry_premium: r.entry_premium,
    flow_avg_fill: r.flow_avg_fill,
    conviction: r.conviction,
    last_mark: r.last_mark,
    live_pnl_pct: r.live_pnl_pct,
    closed_reason: r.closed_reason ?? null,
    plan_outcome: r.plan_outcome,
    plan_pnl_pct: r.plan_pnl_pct,
    first_flagged_at: r.first_flagged_at,
    score: r.score_max,
    spike: r.spike,
    setup: byTicker.get(r.ticker) ?? null,
    cortex: readCortexView(r.cortex) ?? readCortexView(byTicker.get(r.ticker)?.cortex),
    // Pinned commit-time tier ONLY — no fallback to a live re-derivation: the chip
    // grades the decision that printed, and a decision's grade doesn't move after.
    tier: readTierAssignment(r.tier),
    nighthawkEcho: r.nighthawk_echo,
    mark_as_of: r.mark_as_of ?? null,
    mark_source: r.mark_source ?? null,
  }));
  // One-way commit door: a ticker with a committed ledger row is presented from
  // that row ONLY — a concurrent fresh-find evaluation of the same ticker (the
  // scan re-derives gates/plan every build, and a committed name usually still
  // ranks) is dropped as a duplicate here, never allowed to demote the play back
  // to a WATCH/SKIP card. Case-insensitive: ledger tickers are stored uppercase.
  const seen = new Set(ledger.map((r) => r.ticker.toUpperCase()));
  // Fresh finds the cron hasn't persisted yet (≤2 min window) — or MOVED ones we
  // deliberately never open: show them so members see the full picture. After the
  // close they are NOT plays (the scanner refused them past the cutoff) — drop them.
  for (const s of setups) {
    if (seen.has(s.ticker.toUpperCase())) continue;
    if (sessionClosed) continue;
    const moved = s.plan?.entry_status === "MOVED";
    // Hard-gate-blocked finds are SKIP regardless of clock/liquidity — the gate
    // stack (src/lib/zerodte/gates.ts) already decided this is not committable.
    // Same rule zeroDtePlaysForLargo applies, so the pane and Largo can never
    // disagree about whether a blocked find is a play. Everything else is at most
    // WATCH — an uncommitted find NEVER wears OPEN (resolveFreshFindStatus,
    // board.ts): pre-#latch it did, rendered exactly like a live position, and
    // visibly "regressed" to a watch card when the next scan tick's re-derived
    // plan/gate flapped. OPEN is reserved for ledger rows above.
    const status =
      s.gate?.verdict === "BLOCKED"
        ? ("SKIP" as const)
        : resolveFreshFindStatus(heatState, moved, Boolean(s.plan?.illiquid));
    rows.push({
      ticker: s.ticker,
      direction: s.direction,
      strike: s.top_strike,
      expiry: s.expiry || null,
      status,
      committed: false,
      entry_premium: s.plan?.entry_max ?? s.top_strike_avg_fill,
      flow_avg_fill: s.top_strike_avg_fill,
      conviction: s.conviction,
      last_mark: s.plan?.mark ?? null,
      live_pnl_pct: null,
      closed_reason: null,
      plan_outcome: null,
      plan_pnl_pct: null,
      first_flagged_at: s.first_seen,
      score: s.score,
      spike: s.spike,
      setup: s,
      cortex: readCortexView(s.cortex),
      // Refused finds get the F assignment (tierForSkip — the #325 wiring the SKIP
      // cards were promised); WATCH candidates get NO tier (not decisions yet).
      // Same rule as zeroDtePlaysForLargo's fresh lane, so pane and Largo agree.
      tier: status === "SKIP" ? tierForSkip(s.gate?.verdict === "BLOCKED" ? s.gate.blocks : null) : null,
      nighthawkEcho: null,
    });
  }
  const order: Record<PlayRow["status"], number> = { OPEN: 0, TRIM: 1, HOLD: 2, WATCH: 3, SKIP: 4, CLOSED: 5 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || b.score - a.score);
}

// ── header: heat + readiness + governor strip ─────────────────────────────────────

function ReadinessChip({
  data,
  transport,
  hasLivePlays,
  nowMs,
}: {
  data: BoardResponse;
  transport: "sse" | "poll" | null;
  hasLivePlays: boolean;
  nowMs: number;
}) {
  const asOfMs = data.as_of ? Date.parse(data.as_of) : NaN;
  const readiness = resolveZeroDteReadiness({
    serverDegraded: data.degraded === true || data.upstream_ok === false,
    asOfAgeMs: nowMs > 0 && Number.isFinite(asOfMs) ? nowMs - asOfMs : null,
    sessionLive: data.session?.heat?.state !== "CLOSED",
    marksTransport: transport,
    hasLivePlays,
  });
  return (
    <span
      title={readiness.detail}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]",
        readiness.tone === "green"
          ? "border-bull/35 bg-bull/10 text-bull"
          : "border-gold/35 bg-gold/10 text-gold"
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "size-1.5 rounded-full",
          readiness.tone === "green" ? "bg-bull" : "bg-gold animate-pulse motion-reduce:animate-none"
        )}
      />
      {readiness.label}
    </span>
  );
}

/** One mono stat pill for the governor strip — desk v3 silhouette (spx-hero style). */
function GovPill({
  label,
  value,
  tone = "sky",
  title,
}: {
  label: string;
  value: string;
  tone?: "sky" | "bull" | "bear" | "gold";
  title?: string;
}) {
  const toneCls: Record<string, string> = {
    sky: "border-sky-400/20 text-sky-200/90",
    bull: "border-bull/30 text-bull",
    bear: "border-bear/40 text-bear",
    gold: "border-gold/35 text-gold",
  };
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-baseline gap-1.5 rounded-lg border bg-void-deep/80 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
        toneCls[tone]
      )}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">{label}</span>
      <span className="t-num text-[12px] font-bold">{value}</span>
    </span>
  );
}

/** Session governor strip: open-plan cap, stop halt, re-entry locks, correlated-
 *  conflict blocks. Every number is the payload's own; the client adds only the
 *  ticking clock for lock countdowns. */
function GovernorStrip({
  gov,
  conflicts,
  nowMs,
}: {
  gov: BoardGovernor | null | undefined;
  /** SKIP rows currently blocked by correlated_conflict, with the payload's sentence. */
  conflicts: Array<{ ticker: string; direction: string; reason: string }>;
  nowMs: number;
}) {
  if (!gov) {
    return (
      <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-sky-300/40">
        Session governor · state unavailable this cycle — new commits fail closed server-side
      </p>
    );
  }
  const locks =
    nowMs > 0
      ? gov.stops
          .map((s) => ({ ...s, remaining: reentryLockRemainingMs(s.at_ms, gov.reentry_lock_ms, nowMs) }))
          .filter((s): s is typeof s & { remaining: number } => s.remaining != null)
      : [];
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <GovPill
          label="Plans"
          value={`${gov.open_plans.length}/${gov.max_concurrent}`}
          tone={gov.open_plans.length >= gov.max_concurrent ? "gold" : gov.open_plans.length > 0 ? "bull" : "sky"}
          title={
            gov.open_plans.length > 0
              ? `Open: ${gov.open_plans.map((p) => `${p.ticker} ${p.direction}`).join(", ")}`
              : "No plans open"
          }
        />
        <GovPill
          label="Stops"
          value={`${gov.stops.length}/${gov.max_session_stops}`}
          tone={gov.halted ? "bear" : gov.stops.length > 0 ? "gold" : "sky"}
          title={
            gov.stops.length > 0
              ? `Stopped: ${gov.stops.map((s) => `${s.ticker} ${s.direction}`).join(", ")}`
              : "No stops this session"
          }
        />
        {locks.map((l) => (
          <GovPill
            key={`lock-${l.ticker}`}
            label="Lock"
            value={`${l.ticker} ${l.direction} · ${fmtLockRemaining(l.remaining)}`}
            tone="gold"
            title="Same-direction re-entry locked after this ticker's stop"
          />
        ))}
        {conflicts.map((c) => (
          <GovPill
            key={`conflict-${c.ticker}`}
            label="Conflict"
            value={`${c.ticker} ${c.direction} blocked`}
            tone="bear"
            title={c.reason}
          />
        ))}
      </div>
      {gov.halted && (
        <p className="rounded-lg border border-bear/40 bg-bear/[0.08] px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-widest text-bear">
          Session halted — {gov.stops.length} stops (max {gov.max_session_stops}). No new commits for
          the rest of the session.
        </p>
      )}
    </div>
  );
}

function PaneHeader({
  data,
  transport,
  hasLivePlays,
  conflicts,
  nowMs,
}: {
  data: BoardResponse;
  transport: "sse" | "poll" | null;
  hasLivePlays: boolean;
  conflicts: Array<{ ticker: string; direction: string; reason: string }>;
  nowMs: number;
}) {
  const heat = data.session?.heat;
  const asOfMs = data.as_of ? new Date(data.as_of).getTime() : 0;
  const freshnessStatus = resolveZeroDteFreshness(data.upstream_ok, asOfMs, nowMs);
  if (!heat) return null;
  const hot = heat.heat_pct >= 70;
  return (
    <Panel accent={hot ? "bull" : "sky"} bodyClassName="px-5 py-4 md:px-6 md:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Badge tone={hot ? "bull" : heat.heat_pct > 0 ? "sky" : "neutral"} size="md" dot={hot}>
            {heat.label}
          </Badge>
          <span className="truncate text-sm text-sky-200/80">{heat.note}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ReadinessChip data={data} transport={transport} hasLivePlays={hasLivePlays} nowMs={nowMs} />
          <FreshnessChip status={freshnessStatus} asOf={data.as_of ? new Date(data.as_of) : null} />
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <div
          className={clsx(
            "h-full rounded-full transition-[width] duration-700",
            hot
              ? "bg-gradient-to-r from-sky-400 via-bull to-bull shadow-[0_0_12px_rgba(0,230,118,0.6)]"
              : "bg-gradient-to-r from-sky-500/60 to-sky-400"
          )}
          style={{ width: `${Math.max(2, Math.min(100, heat.heat_pct))}%` }}
        />
      </div>
      <GovernorStrip gov={data.governor} conflicts={conflicts} nowMs={nowMs} />
      <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
        0DTE discipline: no new plays after 3:00 ET · everything closes by 3:30 ET · nothing held overnight
      </p>
    </Panel>
  );
}

// ── status + stats cells ──────────────────────────────────────────────────────────

function StatusBadge({ row }: { row: PlayRow }) {
  if (row.status === "OPEN")
    return (
      <Badge tone="bull" size="sm" dot>
        OPEN
      </Badge>
    );
  if (row.status === "TRIM")
    return (
      <Badge tone="accent" size="sm" dot>
        TRIM
      </Badge>
    );
  if (row.status === "HOLD")
    return (
      <Badge tone="sky" size="sm">
        HOLD
      </Badge>
    );
  if (row.status === "WATCH")
    return (
      <Badge tone="sky" size="sm">
        WATCH — NOT COMMITTED
      </Badge>
    );
  if (row.status === "SKIP") {
    const ran = row.setup?.plan?.entry_status === "MOVED";
    const gated = row.setup?.gate?.verdict === "BLOCKED";
    return (
      <Badge tone="bear" size="sm">
        {gated ? "SKIP — GATED" : ran ? "SKIP — RAN" : "SKIP — LATE"}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" size="sm">
      CLOSED
    </Badge>
  );
}

function StatsCell({ row }: { row: PlayRow }) {
  // Final grade (post-session, from the contract's own bars) wins; else live P/L.
  if (row.plan_outcome && row.plan_outcome !== "ungradeable") {
    const win = (row.plan_pnl_pct ?? 0) > 0;
    return (
      <span className={clsx("t-num text-[13px] font-bold", win ? "text-bull" : "text-bear")}>
        {win ? "WIN" : "LOSS"}
        {row.plan_pnl_pct != null ? ` ${row.plan_pnl_pct >= 0 ? "+" : ""}${row.plan_pnl_pct.toFixed(0)}%` : ""}
      </span>
    );
  }
  if (row.live_pnl_pct != null) {
    const up = row.live_pnl_pct >= 0;
    return (
      <span
        className={clsx(
          "t-num text-[13px] font-bold",
          up ? "text-bull" : "text-bear",
          // Stale-honesty (B-9): money numbers older than the freshness bar dim
          // instead of impersonating a live quote.
          row.mark_stale && "opacity-40"
        )}
        title={row.mark_stale ? "Quote is stale — waiting for a live tick" : undefined}
      >
        {up ? "+" : ""}
        {row.live_pnl_pct.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="t-num text-[12px] text-sky-300/50" title="No live quote for this contract yet">
      —
    </span>
  );
}

const ACTION_TONE: Record<IntelAction, "bull" | "sky" | "accent" | "bear" | "neutral"> = {
  ADD: "bull",
  HOLD: "sky",
  TRIM: "accent",
  SELL: "neutral",
  PASS: "bear",
  // Uncommitted candidate (pre-commit honesty) — neutral sky, never the bull tone
  // an actionable ADD wears.
  WATCH: "sky",
};

const NIGHTHAWK_OUTCOME_LABEL: Record<string, string> = {
  target: "hit target",
  stop: "stopped out",
  open: "still open",
  ambiguous: "ambiguous close",
  pending: "pending",
  unfilled: "never filled",
};

// Guarded via the shared shortMonthDay: a null/empty/malformed edition_for previously rendered
// "Invalid Date" in the "Night Hawk had this …" echo row. Now it degrades to "—".
function fmtEditionDate(ymd: string | null | undefined): string {
  return shortMonthDay(ymd);
}

/** BIE cross-instrument annotation: Night Hawk already has a take on this name
 *  from a prior edition. Read-only context — never changes score/status. */
function NighthawkEchoNote({ echo }: { echo: NighthawkEcho }) {
  const outcomeLabel = NIGHTHAWK_OUTCOME_LABEL[echo.outcome] ?? echo.outcome;
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] leading-snug text-violet-200/75">
      <span aria-hidden="true">🔗</span>
      <span>
        {/* nighthawk_play_outcomes stores direction as "LONG"/"SHORT" (uppercase) —
            0DTE's own copy is lowercase everywhere else on this board. */}
        Night Hawk had this {fmtEditionDate(echo.edition_for)} — {echo.direction.toLowerCase()} ({outcomeLabel})
      </span>
    </div>
  );
}

/** BlackOut Intel: one actionable verb + a reason built only from observed numbers. */
function intelFor(row: PlayRow, nowMs: number) {
  return buildIntelNote({
    status: row.status,
    setup: row.setup,
    plan: row.setup?.plan ?? null,
    entryPremium: row.entry_premium,
    livePnlPct: row.live_pnl_pct,
    planOutcome: row.plan_outcome,
    planPnlPct: row.plan_pnl_pct,
    // Live inputs — the line recomputes with every refresh.
    nowEtMinutes: etMinutesOf(nowMs > 0 ? nowMs : Date.now()),
    lastMark: row.last_mark,
  });
}

// ── conviction / size chips ───────────────────────────────────────────────────────

function ConvictionBadge({ raw }: { raw: string | null }) {
  const capped = capConvictionDisplay(raw);
  if (!capped) return null;
  const upper = capped.toUpperCase();
  const tone = upper === "A" ? "bull" : upper === "B" ? "sky" : "neutral";
  const wasCapped = raw != null && capConvictionDisplay(raw) !== raw.trim();
  return (
    <Badge
      tone={tone}
      size="sm"
      title={
        wasCapped
          ? "Scored A+ — display capped at A while the A+ band is under calibration investigation (C-1)."
          : `Conviction ${upper}`
      }
    >
      {upper}
    </Badge>
  );
}

// ── merit tier chip (PR-F) ───────────────────────────────────────────────────────

/** A+ display gate for displayTierFor — the promotion is EARNED from the measured
 *  A-bucket record (tier_record.aplus.unlocked, calibration.ts), never asserted.
 *  Held OFF here because the board payload doesn't carry the calibration report
 *  (it's admin-gated and a heavy ledger-range aggregation — not worth adding to
 *  the 5s board hot path for one chip), and A-as-A is always honest.
 *  TODO(PR-F3): surface tier_record.aplus.unlocked as a tiny cached scalar on the
 *  board payload (computed alongside the record route's existing ledger read) and
 *  thread it through mergePlays to this gate. */
const APLUS_UNLOCKED = false;

/** The tier chip: the commit-time merit grade (or F for a refused find). Tone
 *  follows the pane's severity conventions (ConvictionBadge/StatusBadge): A bull,
 *  B sky, C neutral, F bear. The full factor list renders in the expanded detail
 *  (TierFactorsBlock); the chip's title carries the one-line labels. */
function TierChip({ tier }: { tier: NonNullable<PlayRow["tier"]> }) {
  const display = tier.tier === "F" ? "F" : displayTierFor(tier.tier, APLUS_UNLOCKED);
  const tone =
    display === "F" ? "bear" : display === "A+" || display === "A" ? "bull" : display === "B" ? "sky" : "neutral";
  return (
    <Badge
      tone={tone}
      size="sm"
      title={
        (display === "F"
          ? "Tier F — refused by the desk (skips are F by definition). "
          : `Merit tier ${display} — graded at commit from the pinned entry evidence, never re-derived. `) +
        (tier.factors.length > 0 ? `Factors: ${tier.factors.map((f) => f.label).join(" · ")}.` : "")
      }
    >
      tier {display}
    </Badge>
  );
}

/** "Why this grade" — every point and cap behind the tier, verbatim from the pinned
 *  factors (same visual grammar as the Cortex evidence rows above it). */
function TierFactorsBlock({ tier }: { tier: NonNullable<PlayRow["tier"]> }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
          Merit tier · graded at commit
        </p>
        <span className="t-num text-[11px] font-bold text-sky-200/85">
          tier {tier.tier === "F" ? "F" : displayTierFor(tier.tier, APLUS_UNLOCKED)}
        </span>
      </div>
      <ul className="mt-1.5 space-y-1">
        {tier.factors.map((f, i) => (
          <li key={`${f.label}-${i}`} className="flex items-start gap-2 rounded-md px-1.5 py-1">
            <span
              className={clsx(
                "mt-px shrink-0 font-mono text-[10px] font-semibold",
                f.direction === "up" ? "text-bull/80" : "text-bear/80"
              )}
            >
              {f.direction === "up" ? "▲" : "▼"} {f.label}
            </span>
            <span className="min-w-0 flex-1 text-[11px] leading-snug text-sky-200/85">{f.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SizeChip({ view }: { view: PaneCortexView | null }) {
  const verdict = view && !view.abstained ? view.verdict : null;
  const chip = suggestedZeroDteSize(verdict?.score ?? null, (verdict?.vetoes.length ?? 0) > 0);
  return (
    <span
      title={`${chip.basis} Richer sizing must be earned by ≥30 sessions of calibration — 0.5×/1× only until then.`}
      className={clsx(
        "inline-flex items-baseline gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em]",
        chip.size === "1×" ? "border-bull/30 bg-bull/[0.08] text-bull" : "border-sky-300/25 bg-sky-300/[0.05] text-sky-300"
      )}
    >
      <span className="text-[8px] font-semibold text-sky-300/50">size</span>
      {chip.size}
    </span>
  );
}

// ── Cortex evidence table ─────────────────────────────────────────────────────────

function CortexEvidenceBlock({ view }: { view: PaneCortexView | null }) {
  if (view == null || view.abstained) {
    return (
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
          Evidence · Night Hawk Cortex
        </p>
        <p className="mt-1 text-[11px] text-sky-300/70">
          {view?.abstained
            ? "Evidence engine abstained — gates-only commit. No source could argue for or against this play at commit time; the hard gate stack alone cleared it."
            : "No Cortex verdict on record for this commit — the evidence layer didn't run for it (gates-only)."}
        </p>
        {view?.abstained && view.reason && (
          <p className="mt-1 font-mono text-[10px] leading-snug text-sky-300/40">◦ {view.reason}</p>
        )}
      </div>
    );
  }
  const v = view.verdict;
  const rows = [...v.vetoes, ...v.supports, ...v.opposes].map(evidenceRowParts);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
          Evidence · Night Hawk Cortex
        </p>
        <span className="t-num text-[11px] font-bold text-sky-200/85">
          score {v.score >= 0 ? "+" : ""}
          {v.score.toFixed(2)} · {capConvictionDisplay(v.conviction)}
        </span>
      </div>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r, i) => (
          <li
            key={`${r.tag}-${i}`}
            className={clsx(
              "flex items-start gap-2 rounded-md px-1.5 py-1",
              r.tone === "veto" && "border border-bear/35 bg-bear/[0.08]"
            )}
          >
            <span
              className={clsx(
                "mt-px shrink-0 font-mono text-[10px]",
                r.tone === "veto" ? "font-bold text-bear" : r.tone === "opposes" ? "text-bear/80" : "text-bull/80"
              )}
            >
              {r.tag}
            </span>
            <span className="min-w-0 flex-1 text-[11px] leading-snug text-sky-200/85">{r.detail}</span>
            <span
              className={clsx(
                "t-num shrink-0 text-[11px] font-bold",
                r.tone === "veto" ? "text-bear" : r.tone === "opposes" ? "text-bear/90" : "text-bull"
              )}
            >
              {r.weight}
            </span>
          </li>
        ))}
      </ul>
      {v.absent.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {v.absent.map((line) => (
            <li key={line} className="font-mono text-[10px] leading-snug text-sky-300/40">
              ◦ {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── expanded detail (why picked · what to watch) ─────────────────────────────────

function FactorChips({ f }: { f: NonNullable<EnrichedZeroDteSetup["factor_breakdown"]> }) {
  const chips: Array<[string, number]> = [
    ["Flow", f.flow],
    ["Tech", f.tech],
    ["Pos", f.positioning],
    ["News", f.news],
    ["Smart$", f.smart_money],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(([label, v]) => (
        <span
          key={label}
          className={clsx(
            "rounded-md border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
            v > 0
              ? "border-bull/25 bg-bull/[0.07] text-bull"
              : v < 0
                ? "border-bear/25 bg-bear/[0.07] text-bear"
                : "border-white/10 text-sky-300/60"
          )}
        >
          {label} {v > 0 ? `+${v}` : v}
        </span>
      ))}
    </div>
  );
}

function PlayDetail({ row, nowMs }: { row: PlayRow; nowMs: number }) {
  const s = row.setup;
  const p = s?.plan ?? null;
  const contract = `${row.ticker} ${fmtStrike(row.strike)}${row.direction === "long" ? "c" : "p"}`;
  const entryStr = row.entry_premium != null ? `$${row.entry_premium.toFixed(2)}` : "—";
  const stop = row.entry_premium != null ? row.entry_premium * 0.5 : null;
  const target = row.entry_premium != null ? row.entry_premium * 2 : null;
  return (
    <div className="space-y-3 border-t border-white/[0.06] px-4 py-3">
      <CortexEvidenceBlock view={row.cortex} />

      {/* why this grade (PR-F) — the pinned tier factors, when the row carries them */}
      {row.tier && <TierFactorsBlock tier={row.tier} />}

      {/* why the play was picked */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">Why this play</p>
        {s ? (
          <p className="mt-1 t-num text-[11px] text-sky-200/85">
            {fmtMoney(s.gross_premium)} gross · {Math.round(s.side_dominance * 100)}%{" "}
            {row.direction === "long" ? "call" : "put"}-side · {s.prints} prints ·{" "}
            {Math.round(s.sweep_pct * 100)}% sweeps
            {s.recent_premium_30m > 0 ? ` · ${fmtMoney(s.recent_premium_30m)} last 30m` : ""}
            {s.streak_days != null && s.streak_days > 1 ? ` · ${s.streak_days}d flow streak` : ""}
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-sky-300/70">
            Flagged at {fmtTime(row.first_flagged_at)} ET on stacked one-sided 0DTE flow (peak score {row.score}).
          </p>
        )}
        {s?.factor_breakdown && (
          <div className="mt-2">
            <FactorChips f={s.factor_breakdown} />
          </div>
        )}
        {(s?.catalyst_flags?.length || s?.analyst_note || s?.news_hot) && (
          <div className="mt-2 space-y-0.5 text-[11px] text-sky-200/80">
            {s?.catalyst_flags?.map((c) => <p key={c}>◆ {c}</p>)}
            {s?.analyst_note && <p>◆ {s.analyst_note}</p>}
            {s?.news_hot && (
              <p>
                ◆ {s.news_hot.title} <span className="text-sky-300/60">({s.news_hot.minutes_ago}m ago)</span>
              </p>
            )}
          </div>
        )}
        {s?.direction_confirmed === false && (
          <p className="mt-1.5">
            <Badge tone="bear" size="sm">
              Dossier disagrees with the tape direction
            </Badge>
          </p>
        )}
      </div>

      {/* what to watch — entry to exit */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">What to watch</p>
        <p className="mt-1 t-num text-[11px] text-sky-200/85">
          Entry {entryStr}
          {p?.flow_avg_fill != null ? ` (flow paid ~$${p.flow_avg_fill.toFixed(2)})` : ""} · stop −50%
          {stop != null ? ` ($${stop.toFixed(2)})` : ""} · trim/target +100%
          {target != null ? ` ($${target.toFixed(2)})` : ""} · hard exit 3:30 ET
        </p>
        {(p?.underlying_target != null || p?.underlying_invalid != null || s?.key_supports.length || s?.key_resistances.length) && (
          <p className="mt-1 t-num text-[11px] text-sky-300/75">
            {p?.underlying_target != null ? `Stock target ${fmtNum(p.underlying_target)}` : ""}
            {p?.underlying_invalid != null
              ? ` · idea wrong ${row.direction === "long" ? "below" : "above"} ${fmtNum(p.underlying_invalid)}`
              : ""}
            {s?.vwap != null ? ` · VWAP ${fmtNum(s.vwap)}` : ""}
            {s?.key_supports.length ? ` · S ${s.key_supports.map((l) => fmtNum(l)).join("/")}` : ""}
            {s?.key_resistances.length ? ` · R ${s.key_resistances.map((l) => fmtNum(l)).join("/")}` : ""}
          </p>
        )}
        {row.status === "TRIM" && (
          <p className="mt-1 text-[11px] font-semibold text-cyan-300">
            Premium tagged +100% — take at least half off; manage the rest to the 3:30 ET exit.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
          Flagged {fmtTime(row.first_flagged_at)} ET
          {row.setup?.last_seen ? ` · last print ${fmtTime(row.setup.last_seen)} ET` : ""}
        </span>
        <a
          href={largoHref(row.ticker, contract, entryStr)}
          className="rounded-lg border border-cyan-400/30 bg-cyan-400/[0.08] px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan-300 transition-colors hover:bg-cyan-400/[0.16] hover:text-cyan-200"
        >
          Ask LARGO ↗
        </a>
      </div>
    </div>
  );
}

// ── play cards (committed plans) ──────────────────────────────────────────────────

function PlayCard({ row, nowMs }: { row: PlayRow; nowMs: number }) {
  const [open, setOpen] = useState(false);
  const contract = `${row.ticker} ${fmtStrike(row.strike)}${row.direction === "long" ? "C" : "P"}`;
  const live = row.status === "OPEN" || row.status === "HOLD" || row.status === "TRIM";
  const note = intelFor(row, nowMs);
  const markAge = fmtAge(row.mark_as_of, nowMs);
  const view = row.cortex;
  return (
    <div
      className={clsx(
        "rounded-xl border border-white/[0.08] bg-white/[0.02] transition-colors",
        open ? "bg-white/[0.03]" : "hover:bg-white/[0.03]"
      )}
    >
      <button
        type="button"
        className="block w-full cursor-pointer px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {/* header: status · contract · dir · expiry · conviction · size · closed chip */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <StatusBadge row={row} />
          <span className="t-num text-[14px] font-bold text-white">{contract}</span>
          <Badge tone={row.direction === "long" ? "bull" : "bear"} size="sm">
            {row.direction}
          </Badge>
          <span className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
            exp {row.expiry ? shortMonthDay(row.expiry) : "—"}
          </span>
          {row.tier && <TierChip tier={row.tier} />}
          <ConvictionBadge raw={row.conviction} />
          {live && <SizeChip view={view} />}
          {row.closed_reason === "stopped" && (
            <span className="rounded-md border border-bear/35 bg-bear/[0.08] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-bear">
              stopped −50%
            </span>
          )}
          {row.status === "TRIM" && (
            <span className="rounded-md border border-cyan-400/35 bg-cyan-400/[0.08] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-300">
              +100% tagged
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/40">score</span>
            <span className="t-num text-[12px] font-bold text-sky-200/85">{Math.round(row.score)}</span>
            <span className={clsx("inline-block text-sky-300/40 transition-transform", open && "rotate-90")}>›</span>
          </span>
        </div>

        {/* money row: flow fill → live mark (bid/ask/mid + freshness) → P&L */}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="inline-flex items-baseline gap-1.5">
            <span
              className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50"
              title="Premium-weighted average the FLOW actually paid on the top strike — the plan's entry reference. Not a fill of ours."
            >
              {row.flow_avg_fill != null ? "flow fill" : "entry ref"}
            </span>
            <span className="t-num text-[13px] font-bold text-sky-200/90">
              {row.entry_premium != null ? `$${row.entry_premium.toFixed(2)}` : "—"}
            </span>
          </span>
          {live && (
            <span className={clsx("inline-flex items-baseline gap-1.5", row.mark_stale && "opacity-40")}>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">
                mark{row.mark_source === "last" ? " · last-trade" : row.mark_source === "mid" ? " · mid" : ""}
              </span>
              <span
                className="t-num text-[13px] font-bold text-white"
                title={row.mark_stale ? "Quote is stale — waiting for a live tick" : undefined}
              >
                {row.last_mark != null ? `$${row.last_mark.toFixed(2)}` : "—"}
              </span>
              {row.mark_bid != null && row.mark_ask != null && (
                <span className="t-num text-[10px] text-sky-300/60">
                  {row.mark_bid.toFixed(2)}×{row.mark_ask.toFixed(2)}
                </span>
              )}
              {row.mark_as_of && (
                <span
                  className={clsx(
                    "font-mono text-[9px] uppercase tracking-widest",
                    row.mark_stale ? "text-gold" : "text-sky-300/40"
                  )}
                  title={`Quote as of ${fmtTime(row.mark_as_of)} ET`}
                >
                  {fmtTime(row.mark_as_of)} ET{markAge ? ` · ${markAge}` : ""}
                  {row.mark_stale ? " · stale" : ""}
                </span>
              )}
            </span>
          )}
          <span className="ml-auto">
            <StatsCell row={row} />
          </span>
        </div>

        {/* intel line */}
        <div className="mt-2">
          <div className="flex items-start gap-2">
            <Badge tone={ACTION_TONE[note.action]} size="sm" className="mt-0.5 shrink-0">
              {note.action}
            </Badge>
            <span className="text-[12px] leading-snug text-sky-200/85">{note.reason}</span>
          </div>
          {row.nighthawkEcho && <NighthawkEchoNote echo={row.nighthawkEcho} />}
          {!open && (
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/35">
              {view == null
                ? "cortex: no verdict on record — gates-only"
                : view.abstained
                  ? "cortex: abstained — gates-only commit"
                  : `cortex: ${view.verdict.score >= 0 ? "+" : ""}${view.verdict.score.toFixed(2)} · ${view.verdict.supports.length} for / ${view.verdict.opposes.length} against${view.verdict.vetoes.length > 0 ? ` / ${view.verdict.vetoes.length} veto` : ""}`}
              {" · expand for evidence"}
            </p>
          )}
        </div>
      </button>
      {open && <PlayDetail row={row} nowMs={nowMs} />}
    </div>
  );
}

// ── SKIP / WATCH cards (discipline made visible) ──────────────────────────────────

function SkipCard({ row, nowMs }: { row: PlayRow; nowMs: number }) {
  const contract = `${row.ticker} ${fmtStrike(row.strike)}${row.direction === "long" ? "C" : "P"}`;
  const blocks = row.setup?.gate?.verdict === "BLOCKED" ? row.setup.gate.blocks : [];
  const nowEt = nowMs > 0 ? etMinutesOf(nowMs) : null;
  const moved = row.setup?.plan?.entry_status === "MOVED";
  const illiquid = Boolean(row.setup?.plan?.illiquid);
  const view = row.cortex;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <StatusBadge row={row} />
        <span className="t-num text-[13px] font-bold text-sky-100/90">{contract}</span>
        <Badge tone={row.direction === "long" ? "bull" : "bear"} size="sm">
          {row.direction}
        </Badge>
        {/* F chip (PR-F): a refused find is a graded decision — tier F by definition.
            WATCH candidates carry tier:null (no chip): not a decision yet, no grade.
            The factor detail is the block list below — never duplicated here. */}
        {row.tier && <TierChip tier={row.tier} />}
        <span className="ml-auto flex items-baseline gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/40">score</span>
          <span className="t-num text-[12px] font-bold text-sky-200/80">{Math.round(row.score)}</span>
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {blocks.map((b) => {
          // Widened to string: the cortex wire-in adds veto/net-negative codes to the
          // ZeroDteGateFailure union; until it merges they simply never appear here.
          const code = b.code as string;
          const minsLeft =
            code === "opening_window" && nowEt != null ? minutesUntilEtUnlock(b.threshold, nowEt) : null;
          return (
            <li key={code} className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <span
                className={clsx(
                  "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]",
                  isCortexBlockCode(code) || code === "correlated_conflict" || code === "governor_session_stops"
                    ? "border-bear/35 bg-bear/[0.08] text-bear"
                    : "border-sky-300/25 bg-sky-300/[0.05] text-sky-300"
                )}
                title={`machine code: ${code}`}
              >
                {zeroDteGateLabel(b.code)}
              </span>
              {minsLeft != null && b.unlock_et && (
                <span className="shrink-0 rounded-md border border-gold/35 bg-gold/[0.08] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-gold">
                  unlocks {b.unlock_et} · {minsLeft}m
                </span>
              )}
              <span className="min-w-0 flex-1 basis-full text-[11px] leading-snug text-sky-200/75 sm:basis-auto">
                {b.reason}
              </span>
            </li>
          );
        })}
        {blocks.length === 0 && moved && (
          <li className="text-[11px] leading-snug text-sky-200/75">
            <span className="mr-2 rounded-md border border-sky-300/25 bg-sky-300/[0.05] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-sky-300">
              chase guard
            </span>
            Premium already ran {row.setup?.plan?.vs_flow_pct != null ? `+${row.setup.plan.vs_flow_pct}% ` : ""}
            past the flow&apos;s fill — the move happened. No entry.
          </li>
        )}
        {blocks.length === 0 && !moved && illiquid && (
          <li className="text-[11px] leading-snug text-sky-200/75">
            <span className="mr-2 rounded-md border border-sky-300/25 bg-sky-300/[0.05] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-sky-300">
              liquidity
            </span>
            Bid/ask spread too wide for a 0DTE scalp
            {row.setup?.plan?.spread_pct != null ? ` (${row.setup.plan.spread_pct}% of mark)` : ""} — an
            untradeable market taxes every exit. Watch-only.
          </li>
        )}
        {/* WATCH = an uncommitted candidate (nothing blocked it — it just hasn't
            cleared the desk's commit yet). Rendered here, never as a play card:
            the one-way commit door means it only becomes an OPEN position if the
            desk commits it to the ledger, and that presentation can't flap back. */}
        {row.status === "WATCH" && blocks.length === 0 && !moved && !illiquid && (
          <li className="text-[11px] leading-snug text-sky-200/75">
            <span className="mr-2 rounded-md border border-sky-300/25 bg-sky-300/[0.05] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-sky-300">
              candidate
            </span>
            Fresh find under evaluation — NOT a position. It becomes an OPEN play only after every
            hard gate and confirmation clears at commit; until then, watch-only.
          </li>
        )}
        {row.status !== "WATCH" && blocks.length === 0 && !moved && !illiquid && (
          <li className="text-[11px] leading-snug text-sky-200/75">
            <span className="mr-2 rounded-md border border-sky-300/25 bg-sky-300/[0.05] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-sky-300">
              late window
            </span>
            Flagged after the 3:00 ET cutoff — 0DTE discipline: no fresh entries this late. Watch-only.
          </li>
        )}
      </ul>
      {view != null && !view.abstained && (
        <div className="mt-2.5">
          <CortexEvidenceBlock view={view} />
        </div>
      )}
    </div>
  );
}

function SkipsSection({ rows, nowMs }: { rows: PlayRow[]; nowMs: number }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <Panel
      accent="sky"
      kicker="Discipline · every pass is shown, none are hidden"
      title="Skipped & watching"
      actions={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-sky-400/25 bg-sky-400/[0.06] px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-sky-300 transition-colors hover:bg-sky-400/[0.12]"
          aria-expanded={open}
        >
          {open ? "Hide" : `Show ${rows.length}`}
        </button>
      }
      bodyClassName={open ? "space-y-3 px-4 py-4" : "px-5 py-3"}
    >
      {open ? (
        rows.map((row) => <SkipCard key={row.ticker} row={row} nowMs={nowMs} />)
      ) : (
        <p className="text-[11px] leading-relaxed text-sky-300/60">
          {rows.length} setup{rows.length === 1 ? "" : "s"} the scanner saw but did not commit —
          refused by a hard gate (tape alignment, opening window, score floor, session governor,
          evidence veto), the chase/liquidity/late rules, or still a watch-only candidate awaiting
          the desk&apos;s commit. Expand to see each one in plain English.
        </p>
      )}
    </Panel>
  );
}

// ── record section (measured, never asserted) ─────────────────────────────────────

type RecordBucket = {
  label: string;
  n: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
  low_n: boolean;
};

type RecordPlay = {
  session_date: string;
  ticker: string;
  direction: "long" | "short";
  flagged_et: string;
  score: number;
  conviction: string | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
};

type RecordResponse = {
  available: boolean;
  degraded?: boolean;
  methodology?: string;
  window?: { since: string; through: string; days: number; sessions: number };
  plays?: RecordPlay[];
  total_flagged?: number;
  graded?: number;
  wins?: number;
  losses?: number;
  win_rate_pct?: number | null;
  avg_pnl_pct?: number | null;
  by_time_of_day?: RecordBucket[];
  by_direction?: RecordBucket[];
  by_score_band?: RecordBucket[];
};

const recordFetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" }).then((r) => r.json()) as Promise<RecordResponse>;

function LowNChip() {
  return (
    <span
      className="rounded-md border border-gold/35 bg-gold/[0.08] px-1 py-px font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-gold"
      title={`Fewer than ${LOW_N_THRESHOLD} graded plays in this bucket — not enough samples to read as a track record`}
    >
      n&lt;{LOW_N_THRESHOLD}
    </span>
  );
}

function fmtPct(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${signed && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function CutTable({ title, buckets }: { title: string; buckets: RecordBucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {buckets.map((b) => (
          <li key={b.label} className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-sky-200/75">{b.label}</span>
            {b.low_n && <LowNChip />}
            <span className="t-num shrink-0 text-[10px] text-sky-300/60">
              {b.wins}W/{b.losses}L
            </span>
            <span
              className={clsx(
                "t-num w-[44px] shrink-0 text-right text-[11px] font-bold",
                b.win_rate_pct != null && b.win_rate_pct >= 50 ? "text-bull" : "text-sky-200/80"
              )}
            >
              {fmtPct(b.win_rate_pct)}
            </span>
            <span
              className={clsx(
                "t-num w-[52px] shrink-0 text-right text-[10px]",
                b.avg_pnl_pct != null && b.avg_pnl_pct > 0 ? "text-bull" : b.avg_pnl_pct != null ? "text-bear" : "text-sky-300/50"
              )}
            >
              {fmtPct(b.avg_pnl_pct, true)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RECORD_OUTCOME_LABEL: Record<string, string> = {
  doubled: "+100% target",
  stopped: "stopped",
  time_stop: "time stop",
  ungradeable: "ungradeable",
};

function RecordSection() {
  const { data, error } = useSWR<RecordResponse>("/api/market/zerodte/record?days=30", recordFetcher, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
  });
  if (error || data?.degraded) {
    return (
      <Panel accent="accent" kicker="Measured · 30 days" title="0DTE record">
        <p className="text-[12px] text-sky-300/70">Record temporarily unavailable — it reloads automatically.</p>
      </Panel>
    );
  }
  if (!data) {
    return <Skeleton className="h-48 w-full rounded-2xl" />;
  }
  const headline = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-xl border border-white/[0.07] bg-void-deep/60 px-3.5 py-2.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">Win rate</p>
        <p
          className={clsx(
            "t-num mt-0.5 text-[20px] font-bold leading-none",
            data.win_rate_pct != null && data.win_rate_pct >= 50 ? "text-bull" : "text-white"
          )}
        >
          {fmtPct(data.win_rate_pct)}
        </p>
        <p className="t-num mt-1 text-[10px] text-sky-300/60">
          {data.wins ?? 0}W / {data.losses ?? 0}L graded
        </p>
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-void-deep/60 px-3.5 py-2.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">Avg plan P&L</p>
        <p
          className={clsx(
            "t-num mt-0.5 text-[20px] font-bold leading-none",
            data.avg_pnl_pct != null && data.avg_pnl_pct > 0 ? "text-bull" : data.avg_pnl_pct != null ? "text-bear" : "text-white"
          )}
        >
          {fmtPct(data.avg_pnl_pct, true)}
        </p>
        <p className="mt-1 font-mono text-[10px] text-sky-300/60">per graded play</p>
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-void-deep/60 px-3.5 py-2.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">Graded</p>
        <p className="t-num mt-0.5 text-[20px] font-bold leading-none text-white">{data.graded ?? 0}</p>
        <p className="t-num mt-1 text-[10px] text-sky-300/60">of {data.total_flagged ?? 0} flagged</p>
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-void-deep/60 px-3.5 py-2.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">Sessions</p>
        <p className="t-num mt-0.5 text-[20px] font-bold leading-none text-white">{data.window?.sessions ?? 0}</p>
        <p className="t-num mt-1 text-[10px] text-sky-300/60">last {data.window?.days ?? 30} days</p>
      </div>
    </div>
  );
  return (
    <Panel accent="accent" kicker="Measured · every committed setup, no cherry-picking" title="0DTE record — 30 days">
      <div className="space-y-4">
        {headline}
        {!data.available && (
          <p className="text-[11px] text-sky-300/60">
            No graded plays in the window yet — the record prints itself as sessions grade.
          </p>
        )}
        {data.available && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <CutTable title="By time of day" buckets={data.by_time_of_day ?? []} />
            <CutTable title="By direction" buckets={data.by_direction ?? []} />
            <CutTable title="By score band" buckets={data.by_score_band ?? []} />
          </div>
        )}
        {data.plays && data.plays.length > 0 && (
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">Recent plays</p>
            <ul className="mt-1.5 divide-y divide-white/[0.05]">
              {data.plays.slice(0, 10).map((p) => (
                <li key={`${p.session_date}-${p.ticker}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                  <span className="t-num w-[48px] shrink-0 text-[10px] text-sky-300/50">{shortMonthDay(p.session_date)}</span>
                  <span className="t-num shrink-0 text-[11px] font-bold text-sky-100/90">
                    {p.ticker} {p.direction}
                  </span>
                  {p.flagged_et && (
                    <span className="shrink-0 font-mono text-[10px] text-sky-300/50">{p.flagged_et}</span>
                  )}
                  {capConvictionDisplay(p.conviction) && (
                    <span className="shrink-0 font-mono text-[10px] text-sky-300/60">
                      {capConvictionDisplay(p.conviction)}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-sky-300/60">
                    {p.plan_outcome ? (RECORD_OUTCOME_LABEL[p.plan_outcome] ?? p.plan_outcome) : "ungraded"}
                  </span>
                  <span
                    className={clsx(
                      "t-num w-[56px] shrink-0 text-right text-[11px] font-bold",
                      p.plan_pnl_pct != null && p.plan_pnl_pct > 0
                        ? "text-bull"
                        : p.plan_pnl_pct != null
                          ? "text-bear"
                          : "text-sky-300/40"
                    )}
                    title={p.plan_pnl_pct == null ? "Not graded yet — grades come from the contract's own bars after the session" : undefined}
                  >
                    {p.plan_pnl_pct != null ? fmtPct(p.plan_pnl_pct, true) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.methodology && (
          <p className="border-t border-white/[0.06] pt-3 text-[10px] leading-relaxed text-sky-300/50">
            {data.methodology}
          </p>
        )}
      </div>
    </Panel>
  );
}

// ── the pane ──────────────────────────────────────────────────────────────────────

/**
 * Night Hawk 0DTE — the member-facing pane over the whole 0DTE stack: committed
 * play cards (live marks + Cortex evidence + honest sizing), the discipline layer
 * (every gate-blocked/skipped setup with its reason), the session governor strip,
 * and the measured 30-day record. Statuses are derived server-side from each play's
 * premium vs its fixed rules and latched extremes — OPEN → HOLD → TRIM → CLOSED,
 * everything force-closed by 3:30 ET, no new plays after 3:00 ET. Every number
 * rendered here is a payload field; the client contributes only clocks (countdowns,
 * staleness dimming). Auto-refreshes; no user action needed.
 */
export function ZeroDteBoard() {
  const { data, error } = useSWR<BoardResponse>("/api/market/zerodte/board", fetcher, {
    refreshInterval: (latest) => (latest?.session?.heat?.state === "CLOSED" ? 60_000 : 10_000),
    revalidateOnFocus: true,
  });

  // B-9 live-marks lane: ~1s SSE push (REST poll fallback) for the OPEN plays'
  // mark/P&L, overlaid onto the board's 10s payload below. Off after the close —
  // every play is frozen/graded then, there is nothing live to stream.
  const sessionLive = Boolean(data && data.available !== false && data.session?.heat?.state !== "CLOSED");
  const live = useZeroDteLiveMarks(sessionLive);

  // Pane clock: the live lane ticks at 1s while the session runs; off-hours fall
  // back to a 10s tick so freshness/countdowns still update. Starts at 0 on the
  // server render (SSR-deterministic) — clock-dependent chips appear after mount.
  const [fallbackNowMs, setFallbackNowMs] = useState(0);
  useEffect(() => {
    setFallbackNowMs(Date.now());
    const id = setInterval(() => setFallbackNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  const nowMs = live.nowMs || fallbackNowMs;

  if (error || data?.available === false) {
    return (
      <EmptyState
        icon="◆"
        title="Board temporarily degraded"
        description="Data lanes are unavailable right now — the board recovers automatically."
      />
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  const rows = mergePlays(data.setups ?? [], data.ledger ?? [], data.session?.heat?.state).map((r) =>
    overlayLiveMark(r, live.byTicker.get(r.ticker), nowMs || Date.now())
  );
  const covered = data.covered_elsewhere ?? [];
  // "Today's plays" is committed plans only (its own kicker says so): WATCH rows are
  // uncommitted candidates and live in the skipped-and-watching section below with
  // an explicit candidate label — never rendered as position cards.
  const plays = rows.filter((r) => r.status !== "SKIP" && r.status !== "WATCH");
  const skips = rows.filter((r) => r.status === "SKIP" || r.status === "WATCH");
  const hasLivePlays = plays.some((r) => r.status === "OPEN" || r.status === "HOLD" || r.status === "TRIM");
  const graded = plays.filter((r) => r.plan_outcome && r.plan_outcome !== "ungradeable");
  const wins = graded.filter((r) => (r.plan_pnl_pct ?? 0) > 0).length;
  // Governor-strip conflict pills: named from the SKIP cards' own correlated_conflict
  // blocks (payload sentences) — never re-derived client-side.
  const conflicts = skips.flatMap((r) => {
    const block = r.setup?.gate?.blocks.find((b) => b.code === "correlated_conflict");
    return block ? [{ ticker: r.ticker, direction: r.direction, reason: block.reason }] : [];
  });

  return (
    <div className="space-y-4">
      <PaneHeader
        data={data}
        transport={live.transport}
        hasLivePlays={hasLivePlays}
        conflicts={conflicts}
        nowMs={nowMs}
      />

      <Panel
        accent="bull"
        kicker="Night Hawk 0DTE · committed plans only"
        title="Today's plays"
        actions={
          graded.length > 0 ? (
            <Badge tone={wins * 2 >= graded.length ? "bull" : "bear"} size="sm">
              {wins}W / {graded.length - wins}L
            </Badge>
          ) : (
            <Badge tone={plays.length > 0 ? "bull" : "neutral"} size="sm" dot={plays.length > 0}>
              {plays.length} plays
            </Badge>
          )
        }
        bodyClassName="px-4 py-4"
      >
        {plays.length === 0 ? (
          <p className="px-1 py-2 text-sm text-sky-300/70">
            No committed play right now — and that&apos;s the discipline: the scanner hunts every 2
            minutes, and a plan prints only when the evidence AND every hard gate agree. What it
            refused (and why) is below.
          </p>
        ) : (
          <div className="space-y-3">
            {plays.map((row) => (
              <PlayCard key={row.ticker} row={row} nowMs={nowMs} />
            ))}
          </div>
        )}
        <p className="mt-3 border-t border-white/[0.06] px-1 pt-3 text-[10px] leading-relaxed text-sky-300/50">
          Click a play for its evidence and plan. Statuses update automatically: OPEN (in the entry
          range) → HOLD → TRIM (premium doubled — take some off) → CLOSED (stop, target discipline,
          or the 3:30 ET hard exit). Plays already published elsewhere on the desk are excluded
          {covered.length > 0 ? ` (today: ${covered.join(", ")})` : ""}; grades come from each
          contract&apos;s own prices, not opinion.
        </p>
      </Panel>

      <SkipsSection rows={skips} nowMs={nowMs} />

      <RecordSection />
    </div>
  );
}
