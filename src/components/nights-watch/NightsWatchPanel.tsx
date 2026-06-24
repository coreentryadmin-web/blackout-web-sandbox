"use client";

// Night's Watch — Phase 4 UI.
// Replaces the "Arm an Agent" (Hunt Modes) sidebar on /nighthawk with a per-user
// positions manager: add a position, then watch live P&L + a deterministic
// hold/trim/sell verdict, all served by /api/account/positions.
//
// HONESTY: never renders a fabricated P&L. When valuation_status !== "live" the
// money fields show "—" plus a small live/pending/unavailable tag, and the
// verdict engine itself returns "watch" upstream. No grey — bull/bear/sky/gold/
// mute/white only. Reduced-motion safe (all motion is gated in the design system).

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { NightsWatchDetailModal } from "@/components/nights-watch/NightsWatchDetailModal";
import type { EnrichedPosition, ValuationStatus } from "@/lib/nights-watch/valuation";
import type { Verdict, VerdictAction } from "@/lib/nights-watch/verdict";

// The shape the GET route returns per position: the enriched row + a verdict.
type ApiPosition = EnrichedPosition & { verdict: Verdict };

// Adaptive poll cadence: fast during the RTH session (live WS marks move), relaxed off-hours.
// The GET is a pure cache-reader (cached chain spot + WS marks + pure verdict, no per-user
// upstream), so 5s polling is safe even at 500–1000 users — actual Polygon stays <0.2 rps
// cluster-wide. Never drop below 5s (app/DB concurrency, not a provider limit, is the floor).
const POLL_FAST_MS = 5_000;
const POLL_SLOW_MS = 30_000;

function isEtMarketHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins <= 16 * 60; // 9:30–16:00 ET
}

/** Re-evaluated each poll cycle so the cadence flips automatically at the open/close boundary. */
function getPollMs(now = new Date()): number {
  return isEtMarketHours(now) ? POLL_FAST_MS : POLL_SLOW_MS;
}

// ---------------------------------------------------------------------------
// Verdict chip — colored by action (the brand's signal language):
//   sell  → bear   (cut it)
//   trim  → gold   (take risk off)
//   hold  → bull   (let it run)
//   watch → mute/sky (no decisive read — honest abstention)
// ---------------------------------------------------------------------------
const VERDICT_TONE: Record<VerdictAction, "bull" | "bear" | "sky" | "neutral"> = {
  hold: "bull",
  trim: "neutral", // overridden below to a true gold pill (Badge has no gold tone)
  sell: "bear",
  watch: "sky",
};

const VERDICT_LABEL: Record<VerdictAction, string> = {
  hold: "HOLD",
  trim: "TRIM",
  sell: "SELL",
  watch: "WATCH",
};

// Card accent class that echoes the verdict (drives the left stripe + hover glow
// via CSS custom props in globals.css). A strong SELL reads at a glance.
const VERDICT_CARD_CLASS: Record<VerdictAction, string> = {
  hold: "nighthawk-position-card-hold",
  trim: "nighthawk-position-card-trim",
  sell: "nighthawk-position-card-sell",
  watch: "nighthawk-position-card-watch",
};

// Verdict text tone for the inline "what to do" line.
const VERDICT_TEXT: Record<VerdictAction, string> = {
  hold: "text-bull",
  trim: "text-gold",
  sell: "text-bear",
  watch: "text-sky-300",
};

function VerdictChip({ verdict }: { verdict: Verdict }) {
  // Gold has no Badge tone, so trim renders a bespoke gold pill; the rest reuse Badge.
  if (verdict.action === "trim") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/[0.12] px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-gold tabular-nums">
        TRIM
        <span className="text-gold/70">· {verdict.confidence}</span>
      </span>
    );
  }
  return (
    <Badge tone={VERDICT_TONE[verdict.action]} size="md">
      {VERDICT_LABEL[verdict.action]}
      <span className="opacity-70">· {verdict.confidence}</span>
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Valuation-status tag (honesty signal next to the P&L).
// ---------------------------------------------------------------------------
function StatusTag({ status }: { status: ValuationStatus }) {
  const tone: "bull" | "sky" | "bear" =
    status === "live" ? "bull" : status === "pending" ? "sky" : "bear";
  return (
    <Badge tone={tone} size="sm" dot={status === "live"}>
      {status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers.
// ---------------------------------------------------------------------------
const EM_DASH = "—";

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function num(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  return n.toFixed(digits);
}

function ivPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  // IV arrives as a fraction (e.g. 0.42) — render as a percent.
  return `${(n * 100).toFixed(0)}%`;
}

// A single metric cell in the greeks/risk row.
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-mute">{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-white">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-position form.
// ---------------------------------------------------------------------------
type FormState = {
  ticker: string;
  option_type: "call" | "put";
  strike: string;
  expiry: string;
  side: "long" | "short";
  contracts: string;
  entry_premium: string;
};

const EMPTY_FORM: FormState = {
  ticker: "",
  option_type: "call",
  strike: "",
  expiry: "",
  side: "long",
  contracts: "1",
  entry_premium: "",
};

function validateForm(f: FormState): string | null {
  if (!f.ticker.trim()) return "Ticker is required.";
  const strike = Number(f.strike);
  if (!Number.isFinite(strike) || strike <= 0) return "Strike must be greater than 0.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.expiry) || !Number.isFinite(Date.parse(`${f.expiry}T00:00:00Z`)))
    return "Pick a valid expiry date.";
  const contracts = Number(f.contracts);
  if (!Number.isInteger(contracts) || contracts <= 0) return "Contracts must be a whole number > 0.";
  const premium = Number(f.entry_premium);
  if (!Number.isFinite(premium) || premium < 0) return "Entry premium must be 0 or more.";
  return null;
}

// Shared toggle-pair (call/put, long/short). Two segmented buttons.
function Toggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; tone: "bull" | "bear" | "sky" }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  const TONE_ACTIVE: Record<string, string> = {
    bull: "border-bull/50 bg-bull/15 text-bull",
    bear: "border-bear/50 bg-bear/15 text-bear",
    sky: "border-sky-400/50 bg-sky-400/15 text-sky-300",
  };
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-2 gap-1.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={clsx(
              "h-9 rounded-lg border font-mono text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
              active
                ? TONE_ACTIVE[opt.tone]
                : "border-white/10 bg-white/[0.03] text-mute hover:border-white/20 hover:text-white"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const FIELD_CLASS =
  "h-9 w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 font-mono text-[13px] text-white " +
  "placeholder:text-mute/60 tabular-nums " +
  "focus-visible:outline-none focus-visible:border-sky-400/60 focus-visible:ring-1 focus-visible:ring-sky-400/40";

const LABEL_CLASS = "font-mono text-[10px] uppercase tracking-[0.16em] text-sky-300";

function AddPositionForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/account/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: form.ticker.trim().toUpperCase(),
          option_type: form.option_type,
          strike: Number(form.strike),
          expiry: form.expiry,
          side: form.side,
          contracts: Number(form.contracts),
          entry_premium: Number(form.entry_premium),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Could not add the position. Try again.");
        return;
      }
      setForm(EMPTY_FORM);
      onCreated();
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="nw-ticker" className={LABEL_CLASS}>
          Ticker
        </label>
        <input
          id="nw-ticker"
          aria-label="Ticker symbol"
          className={clsx(FIELD_CLASS, "uppercase tracking-[0.08em]")}
          placeholder="SPX"
          value={form.ticker}
          onChange={(e) => set("ticker", e.target.value.toUpperCase())}
          autoComplete="off"
          maxLength={12}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Type</span>
          <Toggle
            ariaLabel="Option type"
            value={form.option_type}
            onChange={(v) => set("option_type", v)}
            options={[
              { value: "call", label: "Call", tone: "bull" },
              { value: "put", label: "Put", tone: "bear" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Side</span>
          <Toggle
            ariaLabel="Position side"
            value={form.side}
            onChange={(v) => set("side", v)}
            options={[
              { value: "long", label: "Long", tone: "sky" },
              { value: "short", label: "Short", tone: "bear" },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="nw-strike" className={LABEL_CLASS}>
            Strike
          </label>
          <input
            id="nw-strike"
            aria-label="Strike price"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            className={FIELD_CLASS}
            placeholder="6000"
            value={form.strike}
            onChange={(e) => set("strike", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nw-expiry" className={LABEL_CLASS}>
            Expiry
          </label>
          <input
            id="nw-expiry"
            aria-label="Expiry date"
            type="date"
            className={FIELD_CLASS}
            value={form.expiry}
            onChange={(e) => set("expiry", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="nw-contracts" className={LABEL_CLASS}>
            Contracts
          </label>
          <input
            id="nw-contracts"
            aria-label="Number of contracts"
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            className={FIELD_CLASS}
            placeholder="1"
            value={form.contracts}
            onChange={(e) => set("contracts", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nw-premium" className={LABEL_CLASS}>
            Entry premium
          </label>
          <input
            id="nw-premium"
            aria-label="Entry premium per contract"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            className={FIELD_CLASS}
            placeholder="12.50"
            value={form.entry_premium}
            onChange={(e) => set("entry_premium", e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="font-mono text-[11px] leading-relaxed text-bear">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" size="sm" block loading={submitting} disabled={submitting}>
        {submitting ? "Adding…" : "Add position"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// One position card.
// ---------------------------------------------------------------------------
function PositionCard({
  position,
  onChanged,
  onOpenDetail,
}: {
  position: ApiPosition;
  onChanged: () => void;
  onOpenDetail: (id: number) => void;
}) {
  const [busy, setBusy] = useState<null | "close" | "delete">(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const live = position.valuation_status === "live";
  const pnl = position.unrealized_pnl;
  const pnlTone = pnl != null && pnl >= 0 ? "text-bull" : "text-bear";

  async function handleClose() {
    setActionError(null);
    const raw = window.prompt(
      `Close ${position.ticker} ${position.strike}${position.option_type === "call" ? "C" : "P"} — exit premium per contract?`,
      position.valuation?.mark != null ? String(position.valuation.mark) : ""
    );
    if (raw == null) return; // cancelled
    const exit = Number(raw);
    if (!Number.isFinite(exit) || exit < 0) {
      setActionError("Exit premium must be a number ≥ 0.");
      return;
    }
    setBusy("close");
    try {
      const res = await fetch(`/api/account/positions/${position.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed", exit_premium: exit }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setActionError(data?.error ?? "Could not close the position.");
        return;
      }
      onChanged();
    } catch {
      setActionError("Network error — could not close the position.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setActionError(null);
    if (!window.confirm(`Delete ${position.ticker} ${position.strike}${position.option_type === "call" ? "C" : "P"}? This cannot be undone.`))
      return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/account/positions/${position.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setActionError(data?.error ?? "Could not delete the position.");
        return;
      }
      onChanged();
    } catch {
      setActionError("Network error — could not delete the position.");
    } finally {
      setBusy(null);
    }
  }

  // The whole card opens the detail modal (click / Enter / Space). The action buttons
  // stop propagation so Close/Delete never trigger the modal open.
  function openDetail() {
    onOpenDetail(position.id);
  }

  const reason = position.verdict.reasons[0];

  return (
    <article
      className={clsx(
        "nighthawk-position-card",
        VERDICT_CARD_CLASS[position.verdict.action]
      )}
      role="button"
      tabIndex={0}
      aria-label={`View full intel for ${position.ticker} ${position.strike}${position.option_type === "call" ? "C" : "P"}`}
      onClick={openDetail}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail();
        }
      }}
    >
      {/* Top row: ticker (large) + contract spec | verdict pill */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-anton text-[24px] leading-none tracking-tight text-white">
              {position.ticker}
            </span>
            <span
              className={clsx(
                "font-mono text-[14px] font-semibold tabular-nums",
                position.option_type === "call" ? "text-bull" : "text-bear"
              )}
            >
              {position.strike}
              {position.option_type === "call" ? "C" : "P"}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-mute">
            <span>{position.expiry}</span>
            <span aria-hidden>·</span>
            <span className={position.side === "long" ? "text-sky-300" : "text-bear"}>
              {position.side}
            </span>
            <span aria-hidden>·</span>
            <span className="text-white/80">
              ×{position.contracts} @ ${position.entry_premium.toFixed(2)}
            </span>
          </div>
        </div>
        <VerdictChip verdict={position.verdict} />
      </div>

      {/* P&L block — big colored number + % + LIVE/freshness tag. Honest "—" off-live. */}
      <div className="flex items-end justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-mute">
            Unrealized P&amp;L
          </span>
          {live ? (
            <div className="flex items-baseline gap-2">
              <span className={clsx("font-mono text-[26px] font-bold leading-none tabular-nums", pnlTone)}>
                {money(pnl)}
              </span>
              <span className={clsx("font-mono text-[14px] font-semibold tabular-nums", pnlTone)}>
                {pct(position.pnl_pct)}
              </span>
            </div>
          ) : (
            <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-mute">
              {EM_DASH}
            </span>
          )}
        </div>
        <StatusTag status={position.valuation_status} />
      </div>

      {/* Greeks / risk micro-grid — labeled, mono, tidy. 2-col on narrow (mobile / the card at
          ≤sm), 4-col once there's room so 8 cells never cram or overflow. */}
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5 sm:grid-cols-4">
        <Metric label="Mark" value={live ? num(position.valuation?.mark) : EM_DASH} />
        <Metric label="Δ" value={live ? num(position.valuation?.delta) : EM_DASH} />
        <Metric label="Θ/day" value={live ? num(position.valuation?.theta) : EM_DASH} />
        <Metric label="IV" value={live ? ivPct(position.valuation?.iv) : EM_DASH} />
        <Metric label="DTE" value={num(position.dte, 0)} />
        <Metric label="B/E" value={num(position.breakeven)} />
        <Metric label="Dist→K" value={live ? pct(position.distance_to_strike_pct) : EM_DASH} />
        <Metric label="OI" value={live ? num(position.valuation?.openInterest, 0) : EM_DASH} />
      </div>

      {/* One-line "what to do" — first verdict reason, clamped. */}
      {reason && (
        <p className="flex items-start gap-1.5 font-mono text-[11px] leading-snug">
          <span aria-hidden className={clsx("shrink-0", VERDICT_TEXT[position.verdict.action])}>
            ◆
          </span>
          <span className="line-clamp-2 text-sky-300/90">{reason}</span>
        </p>
      )}

      {actionError && (
        <p role="alert" className="font-mono text-[11px] text-bear">
          {actionError}
        </p>
      )}

      {/* Footer actions — all stopPropagation so they never trigger the card's
          open-detail click. "Full intel" is the primary; Close + Delete ghost/danger. */}
      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          block
          onClick={(e) => {
            e.stopPropagation();
            openDetail();
          }}
        >
          Full intel →
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            void handleClose();
          }}
          loading={busy === "close"}
          disabled={busy != null}
        >
          Close
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            void handleDelete();
          }}
          loading={busy === "delete"}
          disabled={busy != null}
        >
          Delete
        </Button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Portfolio summary strip (Tier 2).
//
// Honest aggregation: P&L sums ONLY positions whose valuation is live and whose
// unrealized_pnl is a finite number — never fabricate a 0 for a pending/unavailable
// leg. If no leg is live, the money + return tiles read "—". The return % is a
// cost-weighted blend (Σpnl / Σbasis) so it stays meaningful across mixed sizes.
// ---------------------------------------------------------------------------
type Summary = {
  count: number;
  pnlSum: number | null; // null = no live leg to sum
  returnPct: number | null;
  verdicts: Record<VerdictAction, number>;
};

function summarize(positions: ApiPosition[]): Summary {
  const verdicts: Record<VerdictAction, number> = { hold: 0, trim: 0, sell: 0, watch: 0 };
  let pnlSum = 0; // aggregate $ — ALL live legs (a zero-entry leg still has real $ P&L)
  let returnNum = 0; // return-% numerator — ONLY legs with a definable basis (must match denom)
  let basisSum = 0;
  let livePnlLegs = 0;

  for (const p of positions) {
    verdicts[p.verdict.action] += 1;
    const live = p.valuation_status === "live";
    if (live && p.unrealized_pnl != null && Number.isFinite(p.unrealized_pnl)) {
      pnlSum += p.unrealized_pnl;
      livePnlLegs += 1;
      // Cost basis for this leg = entry premium × contracts × 100 (option multiplier).
      const basis = p.entry_premium * p.contracts * 100;
      // The return % numerator and denominator MUST cover the same leg set, else a zero-basis
      // leg's P&L would inflate the ratio. So a leg counts toward returnNum only when it also
      // contributes a basis. Its $ P&L still counts in pnlSum (the aggregate $ is honest).
      if (Number.isFinite(basis) && basis > 0) {
        basisSum += basis;
        returnNum += p.unrealized_pnl;
      }
    }
  }

  return {
    count: positions.length,
    pnlSum: livePnlLegs > 0 ? pnlSum : null,
    returnPct: basisSum > 0 ? (returnNum / basisSum) * 100 : null,
    verdicts,
  };
}

function StatTile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="nighthawk-watch-stat">
      <span className="nighthawk-watch-stat-label">{label}</span>
      {children}
    </div>
  );
}

function PortfolioSummary({ summary }: { summary: Summary }) {
  const pnlClass =
    summary.pnlSum == null
      ? "nighthawk-watch-stat-value-mute"
      : summary.pnlSum >= 0
        ? "nighthawk-watch-stat-value-bull"
        : "nighthawk-watch-stat-value-bear";
  const retClass =
    summary.returnPct == null
      ? "nighthawk-watch-stat-value-mute"
      : summary.returnPct >= 0
        ? "nighthawk-watch-stat-value-bull"
        : "nighthawk-watch-stat-value-bear";

  return (
    <div className="nighthawk-watch-summary" aria-label="Portfolio summary">
      <StatTile label="Open positions">
        <span className="nighthawk-watch-stat-value">{summary.count}</span>
      </StatTile>

      <StatTile label="Unrealized P&L">
        <span className={clsx("nighthawk-watch-stat-value", pnlClass)}>
          {money(summary.pnlSum)}
        </span>
      </StatTile>

      <StatTile label="Return">
        <span className={clsx("nighthawk-watch-stat-value", retClass)}>
          {pct(summary.returnPct)}
        </span>
      </StatTile>

      <StatTile label="Verdicts">
        <div className="nighthawk-watch-verdict-row">
          <span className="nighthawk-watch-verdict-chip nighthawk-watch-vd-hold">
            {summary.verdicts.hold}
            <span>hold</span>
          </span>
          <span className="nighthawk-watch-verdict-chip nighthawk-watch-vd-trim">
            {summary.verdicts.trim}
            <span>trim</span>
          </span>
          <span className="nighthawk-watch-verdict-chip nighthawk-watch-vd-sell">
            {summary.verdicts.sell}
            <span>sell</span>
          </span>
          <span className="nighthawk-watch-verdict-chip nighthawk-watch-vd-watch">
            {summary.verdicts.watch}
            <span>watch</span>
          </span>
        </div>
      </StatTile>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel.
// ---------------------------------------------------------------------------
type LoadState =
  | { kind: "loading" }
  | { kind: "unauthed" }
  | { kind: "error"; message: string }
  | { kind: "ready"; positions: ApiPosition[] };

export function NightsWatchPanel() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Which position's detail modal is open (null = closed). One fetch per open.
  const [detailId, setDetailId] = useState<number | null>(null);
  // Collapsible add-position form. null = follow default (collapsed when positions
  // exist, expanded when empty); a boolean = the user's explicit choice.
  const [formOpen, setFormOpen] = useState<boolean | null>(null);
  // Keep a ref so the poll loop never shows a flash of skeleton on refetch.
  const loadedOnce = useRef(false);
  // In-flight mutex: poll + focus + initial can all fire load(); if one is slow, skip the next
  // rather than stack overlapping fetches (which would multiply upstream load near the ceiling).
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/account/positions", { cache: "no-store" });
      if (res.status === 401) {
        setState({ kind: "unauthed" });
        loadedOnce.current = true;
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ kind: "error", message: data?.error ?? "Failed to load positions." });
        loadedOnce.current = true;
        return;
      }
      const data = (await res.json()) as { positions: ApiPosition[] };
      setState({ kind: "ready", positions: data.positions ?? [] });
      loadedOnce.current = true;
    } catch {
      setState({ kind: "error", message: "Network error — could not load positions." });
      loadedOnce.current = true;
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Initial load + adaptive poll (self-adjusting timeout re-reads getPollMs() each cycle, so the
  // cadence flips at the market open/close boundary) + refetch on window focus.
  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      void load();
      timer = setTimeout(tick, getPollMs());
    };
    timer = setTimeout(tick, getPollMs());
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const ready = state.kind === "ready" ? state : null;
  const positions = ready?.positions ?? [];
  const hasPositions = positions.length > 0;
  const summary = ready ? summarize(positions) : null;
  // Resolve the collapsible default: collapsed when positions already exist.
  const isFormOpen = formOpen ?? !hasPositions;
  const showLive = state.kind === "ready";

  return (
    <section className="nighthawk-watch" aria-label="Night's Watch positions">
      {/* ---- Tier 1: header ---- */}
      <header className="nighthawk-watch-header">
        <div className="min-w-0">
          <p className="nighthawk-watch-kicker">◆ NIGHT&apos;S WATCH</p>
          <h2 className="nighthawk-watch-title">Your Positions</h2>
          <p className="nighthawk-watch-sub">
            Live P&amp;L + a hold / trim / sell read on every contract — grounded in
            BlackOut&apos;s tools.
          </p>
        </div>
        <span
          className={clsx(
            "nighthawk-watch-live",
            !showLive && "nighthawk-watch-live-idle"
          )}
        >
          <span className="nighthawk-watch-live-dot" aria-hidden />
          {showLive ? "Live · updating" : "Connecting"}
        </span>
      </header>

      {/* ---- Scrollable body: summary · add-form · grid ---- */}
      <div className="nighthawk-watch-body">
        {/* Tier 2: portfolio summary strip (only when we have a loaded set) */}
        {summary && hasPositions && <PortfolioSummary summary={summary} />}

        {/* Tier 3a: collapsible add-position form */}
        {(state.kind === "ready" || state.kind === "loading") && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="nighthawk-watch-addtoggle"
              aria-expanded={isFormOpen}
              aria-controls="nw-add-form"
              onClick={() => setFormOpen(!isFormOpen)}
            >
              <span>{isFormOpen ? "Add a position — hide form" : "Add a position"}</span>
              <span className="nighthawk-watch-addtoggle-icon" aria-hidden>
                ＋
              </span>
            </button>
            {isFormOpen && (
              <div id="nw-add-form">
                <Card padding="sm">
                  <AddPositionForm
                    onCreated={() => {
                      void load();
                      setFormOpen(false);
                    }}
                  />
                </Card>
              </div>
            )}
          </div>
        )}

        {/* Tier 3b: positions grid / states */}
        {state.kind === "loading" && !loadedOnce.current ? (
          <div className="nighthawk-watch-grid" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} padding="sm" className="flex flex-col gap-3">
                <Skeleton height={24} width="55%" />
                <Skeleton height={56} />
                <Skeleton height={44} />
                <Skeleton height={32} />
              </Card>
            ))}
          </div>
        ) : state.kind === "unauthed" ? (
          <EmptyState
            icon="◆"
            title="Sign in to track positions"
            description="Night's Watch keeps your positions private to your account. Sign in to add and monitor them."
            action={
              <Button href="/sign-in" variant="primary" size="sm">
                Sign in
              </Button>
            }
          />
        ) : state.kind === "error" ? (
          <EmptyState
            icon="!"
            title="Couldn't load positions"
            description={state.message}
            action={
              <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        ) : state.kind === "ready" && positions.length === 0 ? (
          <EmptyState
            icon="◆"
            title="No open positions"
            description="No open positions — add your first above."
          />
        ) : state.kind === "ready" ? (
          <div className="nighthawk-watch-grid">
            {positions.map((p) => (
              <PositionCard
                key={p.id}
                position={p}
                onChanged={load}
                onOpenDetail={setDetailId}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Persistent disclaimer */}
      <p className="nighthawk-watch-footer">
        Analysis from BlackOut signals — not financial advice. You decide.
      </p>

      {/* Per-position detail modal — fetches the full cross-tool intel once per open. */}
      {detailId != null && (
        <NightsWatchDetailModal
          positionId={detailId}
          open={detailId != null}
          onClose={() => setDetailId(null)}
        />
      )}
    </section>
  );
}
