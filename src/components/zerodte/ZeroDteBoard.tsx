"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { Badge, EmptyState, FreshnessChip, Panel, Skeleton } from "@/components/ui";
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
  move_pct: number | null;
  direction_hit: boolean | null;
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

function largoHref(s: EnrichedZeroDteSetup): string {
  const q =
    `Analyze the ${s.ticker} 0DTE ${s.direction} setup: ${fmtMoney(s.gross_premium)} gross premium, ` +
    `${Math.round(s.side_dominance * 100)}% ${s.direction === "long" ? "call" : "put"}-side, ` +
    `top strike ${s.top_strike} expiring ${s.expiry}. Is it still valid right now?`;
  return `/terminal?q=${encodeURIComponent(q)}`;
}

// ── heat header (the product's own pulse — no other desk data here) ──────────────

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
      {/* Heat meter — how warmed-up the hunt is right now. */}
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
    </Panel>
  );
}

// ── setup cards (the hero lane) ───────────────────────────────────────────────────

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

function SetupCard({ s }: { s: EnrichedZeroDteSetup }) {
  const long = s.direction === "long";
  return (
    <div className="rounded-xl border border-white/10 bg-[rgba(8,9,14,0.45)] p-4">
      {/* header row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-bold text-white">{s.ticker}</span>
        <Badge tone={long ? "bull" : "bear"} size="sm">
          {long ? "CALLS" : "PUTS"} {fmtNum(s.top_strike, 2)}
        </Badge>
        <span className="font-mono text-[11px] text-sky-300/80">
          {s.dte === 0 ? "0DTE" : "1DTE"} · exp {s.expiry}
        </span>
        {s.spike && (
          <Badge tone="accent" size="sm" dot>
            Flow spike
          </Badge>
        )}
        {s.halted && (
          <Badge tone="bear" size="sm" dot>
            Halted
          </Badge>
        )}
        {s.earnings && (
          <Badge tone="sky" size="sm">
            Earnings {s.earnings.when === "premarket" ? "pre" : "AH"}
            {s.earnings.expected_move_pct != null ? ` ±${s.earnings.expected_move_pct}%` : ""}
          </Badge>
        )}
        {s.direction_confirmed === false && (
          <Badge tone="bear" size="sm">
            Dossier disagrees
          </Badge>
        )}
        <span className="ml-auto inline-flex items-center gap-2">
          {s.dossier_score != null && (
            <span className="font-mono text-[11px] text-sky-300/80">
              Dossier {s.dossier_score}
              {s.conviction ? ` · ${s.conviction}` : ""}
            </span>
          )}
          <span
            className={clsx(
              "rounded-lg border px-2 py-0.5 font-mono text-sm font-bold tabular-nums",
              s.score >= 70
                ? "border-bull/35 bg-bull/10 text-bull"
                : s.score >= 45
                  ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                  : "border-white/10 text-sky-300/70"
            )}
          >
            {s.score}
          </span>
        </span>
      </div>

      {/* tape evidence */}
      <p className="mt-2 font-mono text-[11px] tabular-nums text-sky-200/85">
        {fmtMoney(s.gross_premium)} gross · {Math.round(s.side_dominance * 100)}%{" "}
        {long ? "call" : "put"}-side · {s.prints} prints · {Math.round(s.sweep_pct * 100)}% sweeps
        {s.recent_premium_30m > 0 ? ` · ${fmtMoney(s.recent_premium_30m)} last 30m` : ""}
        {s.streak_days != null && s.streak_days > 1 ? ` · ${s.streak_days}d streak` : ""}
        {s.dark_pool_bias ? ` · DP ${s.dark_pool_bias}` : ""}
      </p>

      {/* chart read */}
      {(s.trend || s.fib_note || s.key_supports.length > 0 || s.key_resistances.length > 0) && (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-sky-300/75">
          {s.trend ? `${s.trend}` : ""}
          {s.rsi14 != null ? ` · RSI ${Math.round(s.rsi14)}` : ""}
          {s.rel_volume != null ? ` · ${s.rel_volume.toFixed(1)}x vol` : ""}
          {s.vwap != null ? ` · VWAP ${fmtNum(s.vwap)}` : ""}
          {s.key_supports.length > 0 ? ` · S ${s.key_supports.map((l) => fmtNum(l)).join("/")}` : ""}
          {s.key_resistances.length > 0 ? ` · R ${s.key_resistances.map((l) => fmtNum(l)).join("/")}` : ""}
        </p>
      )}
      {s.fib_note && (
        <p className="mt-1 text-[11px]">
          <span
            className={clsx(
              "rounded-md border px-1.5 py-0.5 font-mono",
              s.fib_note.golden
                ? "border-gold/40 bg-gold/10 text-gold"
                : "border-sky-400/25 bg-sky-400/[0.07] text-sky-300"
            )}
          >
            {s.fib_note.golden ? "★ " : ""}At {s.fib_note.label} fib ({fmtNum(s.fib_note.price)})
          </span>
        </p>
      )}

      {/* factor breakdown + catalysts */}
      {s.factor_breakdown && (
        <div className="mt-2">
          <FactorChips f={s.factor_breakdown} />
        </div>
      )}
      {(s.catalyst_flags.length > 0 || s.analyst_note || s.news_hot) && (
        <div className="mt-2 space-y-0.5 text-[11px] text-sky-200/80">
          {s.catalyst_flags.map((c) => (
            <p key={c}>◆ {c}</p>
          ))}
          {s.analyst_note && <p>◆ {s.analyst_note}</p>}
          {s.news_hot && (
            <p>
              ◆{" "}
              {s.news_hot.url ? (
                <a
                  href={s.news_hot.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-300 underline decoration-cyan-300/40 hover:text-cyan-200"
                >
                  {s.news_hot.title}
                </a>
              ) : (
                s.news_hot.title
              )}{" "}
              <span className="text-sky-300/60">({s.news_hot.minutes_ago}m ago)</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
          {s.first_seen ? `First print ${fmtTime(s.first_seen)}` : ""}
          {s.last_seen ? ` · last ${fmtTime(s.last_seen)} ET` : ""}
        </span>
        <a
          href={largoHref(s)}
          className="rounded-lg border border-cyan-400/30 bg-cyan-400/[0.08] px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan-300 transition-colors hover:bg-cyan-400/[0.16] hover:text-cyan-200"
        >
          Ask LARGO ↗
        </a>
      </div>
    </div>
  );
}

// ── ledger (the always-on scanner's session record) ──────────────────────────────

function LedgerLane({ rows }: { rows: LedgerRow[] }) {
  if (rows.length === 0) return null;
  const graded = rows.filter((r) => r.graded && r.direction_hit != null);
  const hits = graded.filter((r) => r.direction_hit === true).length;
  return (
    <Panel
      accent="accent"
      kicker="Scanner ledger"
      title="Flagged today"
      actions={
        graded.length > 0 ? (
          <Badge tone={hits * 2 >= graded.length ? "bull" : "bear"} size="sm">
            {hits}/{graded.length} hit
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm">
            {rows.length} flagged
          </Badge>
        )
      }
      bodyClassName="px-5 py-3"
    >
      <ul className="divide-y divide-white/[0.06]">
        {rows.map((r) => (
          <li key={r.ticker} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-mono text-[10px] tabular-nums text-sky-300/60">
              {fmtTime(r.first_flagged_at)} ET
            </span>
            <span className="font-mono text-sm font-bold text-white">{r.ticker}</span>
            <Badge tone={r.direction === "long" ? "bull" : "bear"} size="sm">
              {r.direction === "long" ? "CALLS" : "PUTS"}
              {r.top_strike != null ? ` ${fmtNum(r.top_strike, 2)}` : ""}
            </Badge>
            {r.spike && (
              <Badge tone="accent" size="sm">
                spike
              </Badge>
            )}
            <span className="font-mono text-[11px] tabular-nums text-sky-300/80">
              peak {r.score_max}
              {r.underlying_at_flag != null ? ` · @ ${fmtNum(r.underlying_at_flag)}` : ""}
            </span>
            {r.graded && r.move_pct != null && (
              <span
                className={clsx(
                  "ml-auto font-mono text-[11px] font-bold tabular-nums",
                  r.direction_hit ? "text-bull" : "text-bear"
                )}
              >
                {r.move_pct >= 0 ? "+" : ""}
                {r.move_pct.toFixed(2)}% {r.direction_hit ? "✓" : "✗"}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-relaxed text-sky-300/50">
        Every row is stamped when the scanner FIRST flagged the name (with the live price at that
        moment) and graded against the session close — the hunt&apos;s record is measured, not asserted.
      </p>
    </Panel>
  );
}

// ── board ─────────────────────────────────────────────────────────────────────────

/**
 * 0DTE Command — a standalone product: the always-on hunt for NEW single-name 0DTE
 * plays. The server-side scanner runs every ~2 min through the session (grid-warm
 * cron) and keeps a graded ledger; this component is the live window onto it.
 * Nothing from other desk products is rendered here — names they already cover are
 * excluded server-side so every card is a play members don't already have.
 */
export function ZeroDteBoard() {
  const { data, error } = useSWR<BoardResponse>("/api/market/zerodte/board", fetcher, {
    refreshInterval: (latest) => (latest?.session?.heat?.state === "CLOSED" ? 60_000 : 15_000),
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
        <Skeleton className="h-72 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  const setups = data.setups ?? [];
  const covered = data.covered_elsewhere ?? [];

  return (
    <div className="space-y-4">
      <HeatHeader data={data} />

      <Panel
        accent="bull"
        kicker="Always-on scanner"
        title="Fresh 0DTE finds — new plays only"
        actions={
          <Badge tone={setups.length > 0 ? "bull" : "neutral"} size="sm" dot={setups.length > 0}>
            {setups.length} live
          </Badge>
        }
        bodyClassName="px-5 py-4"
      >
        {setups.length === 0 ? (
          <p className="py-4 text-sm text-sky-300/70">
            Nothing clears the evidence gates right now — the scanner keeps hunting every 2 minutes
            and new finds print here the moment the tape concentrates.
          </p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {setups.map((s) => (
              <SetupCard key={s.ticker} s={s} />
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-sky-300/50">
          New names only: index products and plays already published elsewhere on the desk are
          excluded{covered.length > 0 ? ` (withheld today: ${covered.join(", ")})` : ""}. Finds are
          directional evidence reads, not managed plays with entries/stops.
        </p>
      </Panel>

      <LedgerLane rows={data.ledger ?? []} />
    </div>
  );
}
