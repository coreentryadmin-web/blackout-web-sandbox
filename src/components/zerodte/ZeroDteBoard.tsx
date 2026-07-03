"use client";

import { Fragment, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { Badge, EmptyState, FreshnessChip, Panel, Skeleton, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import type { EnrichedZeroDteSetup, SessionHeat } from "@/lib/zerodte/board";
import { buildIntelNote, type IntelAction } from "@/lib/zerodte/intel";
import { etMinutesOf } from "@/lib/zerodte/plan";

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
  conviction: string | null;
  entry_premium: number | null;
  flow_avg_fill: number | null;
  status: string | null;
  last_mark: number | null;
  live_pnl_pct: number | null;
  move_pct: number | null;
  direction_hit: boolean | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  graded: boolean;
  /** BIE ecosystem echo: this ticker's most recent Night Hawk take, if any (a
   *  prior edition — today's Night Hawk names never reach this scanner). Null
   *  for the vast majority of rows; purely an annotation, never a gate. */
  nighthawk_echo: NighthawkEcho | null;
};

type BoardResponse = {
  available: boolean;
  degraded?: boolean;
  as_of?: string;
  session?: { date: string; trading_day: boolean; heat: SessionHeat };
  setups?: EnrichedZeroDteSetup[];
  ledger?: LedgerRow[];
  covered_elsewhere?: string[];
};

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

function largoHref(ticker: string, contract: string, entry: string): string {
  const q = `Analyze the ${ticker} 0DTE play ${contract} (entry ${entry}). Is it still valid right now — hold, trim, or exit?`;
  return `/terminal?q=${encodeURIComponent(q)}`;
}

// ── merged play row (ledger = source of truth; fresh finds not yet persisted merge in) ──

type PlayRow = {
  ticker: string;
  direction: "long" | "short";
  strike: number | null;
  status: "OPEN" | "HOLD" | "TRIM" | "CLOSED" | "SKIP";
  entry_premium: number | null;
  flow_avg_fill: number | null;
  last_mark: number | null;
  live_pnl_pct: number | null;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  first_flagged_at: string | null;
  score: number;
  spike: boolean;
  /** Full live find (evidence + plan) when this ticker is still in the top-10. */
  setup: EnrichedZeroDteSetup | null;
  /** BIE ecosystem echo — see LedgerRow. Null for fresh finds not yet persisted. */
  nighthawkEcho: NighthawkEcho | null;
};

function mergePlays(
  setups: EnrichedZeroDteSetup[],
  ledger: LedgerRow[],
  heatState: SessionHeat["state"] | undefined
): PlayRow[] {
  // Past the 15:00 ET cutoff no NEW play can open; after the close nothing is live.
  const pastCutoff = heatState === "POWER_HOUR" || heatState === "LATE_SESSION" || heatState === "CLOSED";
  const sessionClosed = heatState === "CLOSED" || heatState === undefined;
  const byTicker = new Map(setups.map((s) => [s.ticker, s]));
  const rows: PlayRow[] = ledger.map((r) => ({
    ticker: r.ticker,
    direction: r.direction,
    strike: r.top_strike,
    // Unknown/null status (e.g. a row the sync couldn't price) falls back by clock:
    // CLOSED once the session is over, HOLD while it's live — never a stale badge.
    status: (["OPEN", "HOLD", "TRIM", "CLOSED"].includes(r.status ?? "")
      ? r.status
      : sessionClosed
        ? "CLOSED"
        : "HOLD") as PlayRow["status"],
    entry_premium: r.entry_premium,
    flow_avg_fill: r.flow_avg_fill,
    last_mark: r.last_mark,
    live_pnl_pct: r.live_pnl_pct,
    plan_outcome: r.plan_outcome,
    plan_pnl_pct: r.plan_pnl_pct,
    first_flagged_at: r.first_flagged_at,
    score: r.score_max,
    spike: r.spike,
    setup: byTicker.get(r.ticker) ?? null,
    nighthawkEcho: r.nighthawk_echo,
  }));
  const seen = new Set(ledger.map((r) => r.ticker));
  // Fresh finds the cron hasn't persisted yet (≤2 min window) — or MOVED ones we
  // deliberately never open: show them so members see the full picture. After the
  // close they are NOT plays (the scanner refused them past the cutoff) — drop them.
  for (const s of setups) {
    if (seen.has(s.ticker)) continue;
    if (sessionClosed) continue;
    const moved = s.plan?.entry_status === "MOVED";
    rows.push({
      ticker: s.ticker,
      direction: s.direction,
      strike: s.top_strike,
      // Past the entry cutoff — or an untradeably wide market — a fresh find is
      // watch-only, never OPEN.
      status: moved || pastCutoff || s.plan?.illiquid ? "SKIP" : "OPEN",
      entry_premium: s.plan?.entry_max ?? s.top_strike_avg_fill,
      flow_avg_fill: s.top_strike_avg_fill,
      last_mark: s.plan?.mark ?? null,
      live_pnl_pct: null,
      plan_outcome: null,
      plan_pnl_pct: null,
      first_flagged_at: s.first_seen,
      score: s.score,
      spike: s.spike,
      setup: s,
      nighthawkEcho: null,
    });
  }
  const order: Record<PlayRow["status"], number> = { OPEN: 0, TRIM: 1, HOLD: 2, SKIP: 3, CLOSED: 4 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || b.score - a.score);
}

// ── heat header ───────────────────────────────────────────────────────────────────

function HeatHeader({ data }: { data: BoardResponse }) {
  const heat = data.session?.heat;
  if (!heat) return null;
  const hot = heat.heat_pct >= 70;
  return (
    <Panel accent={hot ? "bull" : "sky"} bodyClassName="px-5 py-4 md:px-6 md:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge tone={hot ? "bull" : heat.heat_pct > 0 ? "sky" : "neutral"} size="md" dot={hot}>
            {heat.label}
          </Badge>
          <span className="text-sm text-sky-200/80">{heat.note}</span>
        </div>
        <FreshnessChip status="live" asOf={data.as_of ? new Date(data.as_of) : null} />
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
  if (row.status === "SKIP") {
    const ran = row.setup?.plan?.entry_status === "MOVED";
    return (
      <Badge tone="bear" size="sm">
        {ran ? "SKIP — RAN" : "SKIP — LATE"}
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
      <span className={clsx("font-mono text-[12px] font-bold tabular-nums", win ? "text-bull" : "text-bear")}>
        {win ? "WIN" : "LOSS"}
        {row.plan_pnl_pct != null ? ` ${row.plan_pnl_pct >= 0 ? "+" : ""}${row.plan_pnl_pct.toFixed(0)}%` : ""}
      </span>
    );
  }
  if (row.live_pnl_pct != null) {
    const up = row.live_pnl_pct >= 0;
    return (
      <span className={clsx("font-mono text-[12px] font-bold tabular-nums", up ? "text-bull" : "text-bear")}>
        {up ? "+" : ""}
        {row.live_pnl_pct.toFixed(1)}%
      </span>
    );
  }
  return <span className="font-mono text-[11px] text-sky-300/50">—</span>;
}

const ACTION_TONE: Record<IntelAction, "bull" | "sky" | "accent" | "bear" | "neutral"> = {
  ADD: "bull",
  HOLD: "sky",
  TRIM: "accent",
  SELL: "neutral",
  PASS: "bear",
};

const NIGHTHAWK_OUTCOME_LABEL: Record<string, string> = {
  target: "hit target",
  stop: "stopped out",
  open: "still open",
  ambiguous: "ambiguous close",
  pending: "pending",
};

function fmtEditionDate(ymd: string): string {
  try {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  } catch {
    return ymd;
  }
}

/** BIE cross-instrument annotation: Night Hawk already has a take on this name
 *  from a prior edition. Read-only context — never changes score/status. */
function NighthawkEchoNote({ echo }: { echo: NighthawkEcho }) {
  const outcomeLabel = NIGHTHAWK_OUTCOME_LABEL[echo.outcome] ?? echo.outcome;
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] leading-snug text-violet-200/75">
      <span aria-hidden="true">🔗</span>
      <span>
        Night Hawk had this {fmtEditionDate(echo.edition_for)} — {echo.direction} ({outcomeLabel})
      </span>
    </div>
  );
}

/** BlackOut Intel: one actionable verb + a reason built only from observed numbers. */
function intelFor(row: PlayRow) {
  return buildIntelNote({
    status: row.status,
    setup: row.setup,
    plan: row.setup?.plan ?? null,
    entryPremium: row.entry_premium,
    livePnlPct: row.live_pnl_pct,
    planOutcome: row.plan_outcome,
    planPnlPct: row.plan_pnl_pct,
    // Live inputs — the line recomputes with every 10s refresh.
    nowEtMinutes: etMinutesOf(Date.now()),
    lastMark: row.last_mark,
  });
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

function PlayDetail({ row }: { row: PlayRow }) {
  const s = row.setup;
  const p = s?.plan ?? null;
  const contract = `${row.ticker} ${fmtStrike(row.strike)}${row.direction === "long" ? "c" : "p"}`;
  const entryStr = row.entry_premium != null ? `$${row.entry_premium.toFixed(2)}` : "—";
  const stop = row.entry_premium != null ? row.entry_premium * 0.5 : null;
  const target = row.entry_premium != null ? row.entry_premium * 2 : null;
  return (
    <div className="space-y-3 px-4 py-3">
      {/* why the play was picked */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">Why this play</p>
        {s ? (
          <p className="mt-1 font-mono text-[11px] tabular-nums text-sky-200/85">
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

      {/* live premium math — updates with every refresh */}
      {row.last_mark != null && row.entry_premium != null && row.status !== "CLOSED" && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">Live</p>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-sky-200/85">
            Mark ${row.last_mark.toFixed(2)}
            {row.live_pnl_pct != null ? (
              <span className={row.live_pnl_pct >= 0 ? " text-bull" : " text-bear"}>
                {" "}
                ({row.live_pnl_pct >= 0 ? "+" : ""}
                {row.live_pnl_pct.toFixed(1)}%)
              </span>
            ) : null}
            {" · "}${Math.max(0, row.entry_premium * 2 - row.last_mark).toFixed(2)} to the trim · $
            {Math.max(0, row.last_mark - row.entry_premium * 0.5).toFixed(2)} above the stop
          </p>
        </div>
      )}

      {/* what to watch — entry to exit */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">What to watch</p>
        <p className="mt-1 font-mono text-[11px] tabular-nums text-sky-200/85">
          Entry {entryStr}
          {p?.flow_avg_fill != null ? ` (flow paid ~$${p.flow_avg_fill.toFixed(2)})` : ""} · stop −50%
          {stop != null ? ` ($${stop.toFixed(2)})` : ""} · trim/target +100%
          {target != null ? ` ($${target.toFixed(2)})` : ""} · hard exit 3:30 ET
        </p>
        {(p?.underlying_target != null || p?.underlying_invalid != null || s?.key_supports.length || s?.key_resistances.length) && (
          <p className="mt-1 font-mono text-[11px] tabular-nums text-sky-300/75">
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
        {row.status === "SKIP" &&
          (s?.plan?.entry_status === "MOVED" ? (
            <p className="mt-1 text-[11px] font-semibold text-bear">
              Premium already ran {s?.plan?.vs_flow_pct != null ? `+${s.plan.vs_flow_pct}% ` : ""}past the
              flow&apos;s fill — the move happened. No entry.
            </p>
          ) : (
            <p className="mt-1 text-[11px] font-semibold text-bear">
              Flagged after the 3:00 ET cutoff — 0DTE discipline: no fresh entries this late. Watch-only.
            </p>
          ))}
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

// ── the plays table ───────────────────────────────────────────────────────────────

function PlaysTable({ rows }: { rows: PlayRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[680px]">
        <THead>
          <TR>
            <TH className="w-[90px]">Status</TH>
            <TH className="w-[190px]">Play</TH>
            <TH>BlackOut Intel</TH>
            <TH className="w-[110px] text-right">Stats</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const expanded = open === row.ticker;
            const contract = `${row.ticker} ${fmtStrike(row.strike)}${row.direction === "long" ? "c" : "p"}`;
            return (
              <Fragment key={row.ticker}>
                <TR
                  className={clsx("cursor-pointer transition-colors hover:bg-white/[0.03]", expanded && "bg-white/[0.03]")}
                  onClick={() => setOpen(expanded ? null : row.ticker)}
                  aria-expanded={expanded}
                >
                  <TD>
                    <StatusBadge row={row} />
                  </TD>
                  <TD className="whitespace-nowrap">
                    <div className="font-mono text-[13px] font-bold text-white">{contract}</div>
                    <div className="font-mono text-[11px] tabular-nums text-sky-200/85">
                      {row.entry_premium != null ? `@ ${row.entry_premium.toFixed(2)}` : ""}
                      {row.last_mark != null && row.status !== "CLOSED" ? ` → ${row.last_mark.toFixed(2)}` : ""}
                    </div>
                  </TD>
                  <TD>
                    {(() => {
                      const note = intelFor(row);
                      return (
                        <div>
                          <div className="flex items-start gap-2">
                            <Badge tone={ACTION_TONE[note.action]} size="sm" className="mt-0.5 shrink-0">
                              {note.action}
                            </Badge>
                            <span className="text-[12px] leading-snug text-sky-200/85">{note.reason}</span>
                          </div>
                          {row.nighthawkEcho && <NighthawkEchoNote echo={row.nighthawkEcho} />}
                        </div>
                      );
                    })()}
                  </TD>
                  <TD className="text-right">
                    <StatsCell row={row} />
                    <span className={clsx("ml-2 inline-block text-sky-300/40 transition-transform", expanded && "rotate-90")}>
                      ›
                    </span>
                  </TD>
                </TR>
                {expanded && (
                  <TR className="bg-[rgba(8,9,14,0.5)]">
                    <TD colSpan={4} className="p-0">
                      <PlayDetail row={row} />
                    </TD>
                  </TR>
                )}
              </Fragment>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

// ── board ─────────────────────────────────────────────────────────────────────────

/**
 * 0DTE Command — the always-on hunt, presented as a live plays table
 * (Status | Play | BlackOut Intel | Stats). Statuses are derived server-side from
 * each play's premium vs its fixed rules and latched extremes — OPEN → HOLD →
 * TRIM → CLOSED, everything force-closed by 3:30 ET, no new plays after 3:00 ET.
 * Rows expand to show why the play was picked and what to watch. Auto-refreshes;
 * no user action needed.
 */
export function ZeroDteBoard() {
  const { data, error } = useSWR<BoardResponse>("/api/market/zerodte/board", fetcher, {
    refreshInterval: (latest) => (latest?.session?.heat?.state === "CLOSED" ? 60_000 : 10_000),
    revalidateOnFocus: true,
  });

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
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }

  const rows = mergePlays(data.setups ?? [], data.ledger ?? [], data.session?.heat?.state);
  const covered = data.covered_elsewhere ?? [];
  // Only the strongest get top billing: A-tier = conviction score ≥ 55, dossier not
  // disagreeing, tradeable. Everything else (including PASSes) lives on the radar —
  // visible and still measured, but never presented as a play to take.
  const aTier = rows.filter(
    (r) =>
      r.status !== "SKIP" &&
      r.score >= 55 &&
      r.setup?.direction_confirmed !== false &&
      r.setup?.intraday_conflict !== true
  );
  const radar = rows.filter((r) => !aTier.includes(r));
  const graded = rows.filter((r) => r.plan_outcome && r.plan_outcome !== "ungradeable");
  const wins = graded.filter((r) => (r.plan_pnl_pct ?? 0) > 0).length;

  return (
    <div className="space-y-4">
      <HeatHeader data={data} />

      <Panel
        accent="bull"
        kicker="Always-on scanner · new plays only"
        title="Today's 0DTE plays"
        actions={
          graded.length > 0 ? (
            <Badge tone={wins * 2 >= graded.length ? "bull" : "bear"} size="sm">
              {wins}W / {graded.length - wins}L
            </Badge>
          ) : (
            <Badge tone={rows.length > 0 ? "bull" : "neutral"} size="sm" dot={rows.length > 0}>
              {rows.length} plays
            </Badge>
          )
        }
        bodyClassName="px-0 py-0"
      >
        {aTier.length === 0 ? (
          <p className="px-5 py-6 text-sm text-sky-300/70">
            No A-tier play right now — and that&apos;s the discipline: the scanner hunts every 2
            minutes, and only conviction-grade tape prints here. Lower-grade activity sits on the
            radar below.
          </p>
        ) : (
          <PlaysTable rows={aTier} />
        )}
        <p className="px-5 py-3 text-[10px] leading-relaxed text-sky-300/50">
          Click a play for why it was picked and what to watch. Statuses update automatically: OPEN
          (in the entry range) → HOLD → TRIM (premium doubled — take some off) → CLOSED (stop, target
          discipline, or the 3:30 ET hard exit). Plays already published elsewhere on the desk are
          excluded{covered.length > 0 ? ` (today: ${covered.join(", ")})` : ""}; grades come from each
          contract&apos;s own prices, not opinion.
        </p>
      </Panel>

      {radar.length > 0 && (
        <Panel
          accent="sky"
          kicker="Radar"
          title="Watching — not plays"
          actions={
            <Badge tone="neutral" size="sm">
              {radar.length}
            </Badge>
          }
          bodyClassName="px-0 py-0"
        >
          <PlaysTable rows={radar} />
          <p className="px-5 py-3 text-[10px] leading-relaxed text-sky-300/50">
            Real tape that failed a conviction gate — score below 55, dossier disagreement, already
            ran, too late, or an untradeable spread. Tracked and graded like everything else, but not
            presented as money plays.
          </p>
        </Panel>
      )}
    </div>
  );
}
