"use client";

import { Fragment, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { Badge, EmptyState, FreshnessChip, Panel, Skeleton, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import type { EnrichedZeroDteSetup, SessionHeat } from "@/lib/zerodte/board";

// ── Response shape (structural mirror of /api/market/zerodte/board) ──────────────

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
};

function mergePlays(setups: EnrichedZeroDteSetup[], ledger: LedgerRow[]): PlayRow[] {
  const byTicker = new Map(setups.map((s) => [s.ticker, s]));
  const rows: PlayRow[] = ledger.map((r) => ({
    ticker: r.ticker,
    direction: r.direction,
    strike: r.top_strike,
    status: (["OPEN", "HOLD", "TRIM", "CLOSED"].includes(r.status ?? "") ? r.status : "HOLD") as PlayRow["status"],
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
  }));
  const seen = new Set(ledger.map((r) => r.ticker));
  // Fresh finds the cron hasn't persisted yet (≤2 min window) — or MOVED ones we
  // deliberately never open: show them so members see the full picture.
  for (const s of setups) {
    if (seen.has(s.ticker)) continue;
    const moved = s.plan?.entry_status === "MOVED";
    rows.push({
      ticker: s.ticker,
      direction: s.direction,
      strike: s.top_strike,
      status: moved ? "SKIP" : "OPEN",
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
  if (row.status === "SKIP")
    return (
      <Badge tone="bear" size="sm">
        SKIP — RAN
      </Badge>
    );
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

/** One-line BlackOut Intel: the technical read behind the play. */
function intelLine(row: PlayRow): string {
  const s = row.setup;
  if (!s) return row.spike ? "Sudden flow spike on the tape" : "Stacked one-sided 0DTE flow";
  const bits: string[] = [];
  if (s.trend) bits.push(s.trend);
  if (s.rsi14 != null) bits.push(`RSI ${Math.round(s.rsi14)}`);
  if (s.rel_volume != null) bits.push(`${s.rel_volume.toFixed(1)}x vol`);
  if (s.fib_note) bits.push(`${s.fib_note.golden ? "★ golden" : s.fib_note.label} fib`);
  if (s.dark_pool_bias) bits.push(`DP ${s.dark_pool_bias}`);
  if (s.spike) bits.push("flow spike");
  if (s.earnings) bits.push(`earnings ${s.earnings.when === "premarket" ? "pre" : "AH"}`);
  return bits.slice(0, 4).join(" · ") || "Stacked one-sided 0DTE flow";
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
        {row.status === "SKIP" && (
          <p className="mt-1 text-[11px] font-semibold text-bear">
            Premium already ran {s?.plan?.vs_flow_pct != null ? `+${s.plan.vs_flow_pct}% ` : ""}past the flow&apos;s
            fill — the move happened. No entry.
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

// ── the plays table ───────────────────────────────────────────────────────────────

function PlaysTable({ rows }: { rows: PlayRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[640px]">
        <THead>
          <TR>
            <TH>Status</TH>
            <TH>Play</TH>
            <TH>BlackOut Intel</TH>
            <TH className="text-right">Stats</TH>
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
                  <TD>
                    <span className="font-mono text-[13px] font-bold text-white">{contract}</span>{" "}
                    <span className="font-mono text-[12px] tabular-nums text-sky-200/85">
                      {row.entry_premium != null ? `@ ${row.entry_premium.toFixed(2)}` : ""}
                      {row.last_mark != null && row.status !== "CLOSED" ? ` → ${row.last_mark.toFixed(2)}` : ""}
                    </span>
                    {row.spike && (
                      <span className="ml-1.5 align-middle">
                        <Badge tone="accent" size="sm">
                          spike
                        </Badge>
                      </span>
                    )}
                  </TD>
                  <TD>
                    <span className="text-[12px] text-sky-200/80">{intelLine(row)}</span>
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

  const rows = mergePlays(data.setups ?? [], data.ledger ?? []);
  const covered = data.covered_elsewhere ?? [];
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
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-sky-300/70">
            Nothing clears the evidence gates yet — the scanner hunts every 2 minutes and plays print
            here the moment the tape concentrates.
          </p>
        ) : (
          <PlaysTable rows={rows} />
        )}
        <p className="px-5 py-3 text-[10px] leading-relaxed text-sky-300/50">
          Click a play for why it was picked and what to watch. Statuses update automatically: OPEN
          (in the entry range) → HOLD → TRIM (premium doubled — take some off) → CLOSED (stop, target
          discipline, or the 3:30 ET hard exit). Plays already published elsewhere on the desk are
          excluded{covered.length > 0 ? ` (today: ${covered.join(", ")})` : ""}; grades come from each
          contract&apos;s own prices, not opinion.
        </p>
      </Panel>
    </div>
  );
}
