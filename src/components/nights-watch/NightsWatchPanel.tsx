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
import { usePositionStream } from "@/hooks/usePositionStream";
import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { PersonalAlertsSettings } from "@/components/nights-watch/PersonalAlertsSettings";
import { NightsWatchDetailModal } from "@/components/nights-watch/NightsWatchDetailModal";
import { CollapsibleTile } from "@/components/nighthawk/CollapsibleTile";
import type { EnrichedPosition, ValuationStatus } from "@/lib/nights-watch/valuation";
import type { Verdict, VerdictAction } from "@/lib/nights-watch/verdict";
import { holdsSpxFamily, resolveCoachView } from "@/lib/nights-watch/coach-view";
import { isEtMarketHours } from "@/lib/et-market-hours";

// The shape the GET route returns per position: the enriched row + a verdict.
type ApiPosition = EnrichedPosition & { verdict: Verdict };

// Portfolio Greeks aggregate from the GET response.
type PortfolioGreeks = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  totalPremiumAtRisk: number;
  totalDeltaDollars: number;
  liveLegs: number;
};

// Adaptive poll cadence: fast during the RTH session (live WS marks move), relaxed off-hours.
// The GET is a pure cache-reader (cached chain spot + WS marks + pure verdict, no per-user
// upstream), so 5s polling is safe even at 500–1000 users — actual Polygon stays <0.2 rps
// cluster-wide. Never drop below 5s (app/DB concurrency, not a provider limit, is the floor).
const POLL_FAST_MS = 5_000;
const POLL_SLOW_MS = 30_000;

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
  const tone: "bull" | "sky" | "bear" | "neutral" =
    status === "live" ? "bull" : status === "pending" ? "sky" : status === "stale" ? "neutral" : "bear";
  return (
    <Badge tone={tone} size="sm" dot={status === "live"}>
      {status === "stale" ? "prior close" : status}
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

// Distance-to-strike with a moneyness qualifier. distance_to_strike_pct = (K − spot)/spot,
// so the SAME positive number means OTM for a call but ITM for a put (and vice-versa) —
// ambiguous on its own. Append OTM/ITM (derived from sign × option_type) so the reader can't
// misread it; |dist| < 0.05% reads ATM.
function distToStrike(n: number | null | undefined, optionType: "call" | "put"): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  if (Math.abs(n) < 0.05) return "ATM";
  // Call: K above spot (n > 0) → OTM. Put: K above spot (n > 0) → ITM.
  const otm = optionType === "call" ? n > 0 : n < 0;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}% ${otm ? "OTM" : "ITM"}`;
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
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-400">{label}</span>
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
                : "border-white/10 bg-white/[0.03] text-sky-300 hover:border-white/20 hover:text-white"
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
  "placeholder:text-sky-300/50 tabular-nums " +
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
          aria-required="true"
          aria-describedby={error ? "nw-form-error" : undefined}
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
            aria-required="true"
            aria-describedby={error ? "nw-form-error" : undefined}
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
            aria-required="true"
            aria-describedby={error ? "nw-form-error" : undefined}
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
            aria-required="true"
            aria-describedby={error ? "nw-form-error" : undefined}
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
            aria-required="true"
            aria-describedby={error ? "nw-form-error" : undefined}
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
        <p id="nw-form-error" role="alert" className="font-mono text-[11px] leading-relaxed text-bear">
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
  // I-05: the Close + Delete actions use inline UI instead of native browser dialogs (off-brand for a money desk).
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeExit, setCloseExit] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const live = position.valuation_status === "live";
  const pnl = position.unrealized_pnl;
  const pnlTone = pnl != null && pnl >= 0 ? "text-bull" : "text-bear";
  // A CLOSED position reports a settled REALIZED P&L instead of a live unrealized one.
  const closed = position.status === "closed";
  const realized = position.realized_pnl;
  const hasRealized = realized != null && Number.isFinite(realized);
  const realizedTone = realized != null && realized >= 0 ? "text-bull" : "text-bear";

  function openCloseForm() {
    setActionError(null);
    setConfirmDelete(false);
    // Prefill the live mark so the common "close at mark" path is one keystroke (Enter).
    setCloseExit(position.valuation?.mark != null ? String(position.valuation.mark) : "");
    setCloseOpen(true);
  }

  async function submitClose() {
    setActionError(null);
    const exit = Number(closeExit);
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
      setCloseOpen(false);
      onChanged();
    } catch {
      setActionError("Network error — could not close the position.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDeleteAction() {
    setActionError(null);
    setBusy("delete");
    try {
      const res = await fetch(`/api/account/positions/${position.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setActionError(data?.error ?? "Could not delete the position.");
        return;
      }
      setConfirmDelete(false);
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
            <span className="font-syne text-[22px] font-bold leading-none tracking-tight text-white">
              {position.ticker}
            </span>
            {/* Direction recognition: CALL strike/type in emerald, PUT in bear. This
                is direction (call/put) — NOT side (long/short), which is shown
                separately below. The strike is small (14px) inline text, so PUT uses
                the AA-safe --bear-text (#ff5c78 ~5.0:1) rather than display --bear
                (#ff2d55 ~4.0:1, sub-AA at this size); CALL emerald already clears AA. */}
            <span
              className={clsx(
                "font-mono text-[14px] font-semibold tabular-nums",
                position.option_type === "call" ? "text-bull" : "text-bear-text"
              )}
            >
              {position.strike}
              {position.option_type === "call" ? "C" : "P"}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-sky-300">
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
        {/* A settled position is done — its forward-looking verdict ("watch · can't judge yet")
            would mislead, so closed cards show a neutral SETTLED tag instead of the verdict chip. */}
        {closed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-400/[0.1] px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300">
            Settled
          </span>
        ) : (
          <VerdictChip verdict={position.verdict} />
        )}
      </div>

      {/* P&L block — big colored number + % + LIVE/freshness tag. Honest "—" off-live.
          A CLOSED position shows its settled REALIZED P&L (same emerald/bear-by-sign
          treatment) in place of the live unrealized figure. */}
      <div className="flex items-end justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-400">
            {closed ? "Realized P&L" : "Unrealized P&L"}
          </span>
          {closed ? (
            hasRealized ? (
              <div className="flex items-baseline gap-2">
                <span className={clsx("font-mono text-[26px] font-bold leading-none tabular-nums", realizedTone)}>
                  {money(realized)}
                </span>
                <span className={clsx("font-mono text-[14px] font-semibold tabular-nums", realizedTone)}>
                  {pct(position.realized_pnl_pct)}
                </span>
              </div>
            ) : (
              <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-sky-300">
                {EM_DASH}
              </span>
            )
          ) : live ? (
            <div className="flex items-baseline gap-2">
              <span className={clsx("font-mono text-[26px] font-bold leading-none tabular-nums", pnlTone)}>
                {money(pnl)}
              </span>
              <span className={clsx("font-mono text-[14px] font-semibold tabular-nums", pnlTone)}>
                {pct(position.pnl_pct)}
              </span>
            </div>
          ) : (
            <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-sky-300">
              {EM_DASH}
            </span>
          )}
          {/* #7b truth: P&L driven off yesterday's session close (illiquid/overnight) must NOT read as
              a live mark. Surface it so the figure is honest rather than fabricated-fresh. */}
          {!closed && live && position.mark_is_day_close && (
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-amber-300/90">
              prior close · not live
            </span>
          )}
        </div>
        <StatusTag status={position.valuation_status} />
      </div>

      {/* Greeks / risk micro-grid — labeled, mono, tidy. 2-col on narrow (mobile / the card at
          ≤sm), 4-col once there's room so 8 cells never cram or overflow.
          Off-live (unavailable / pending) the live-gated cells would all read "—", which looks
          broken. So instead of a grid of dashes we collapse to one honest "resumes at the open"
          line — the card reads as deliberately idle, waiting for the bell, not failed. */}
      {closed ? (
        // A settled position has no live greeks/valuation to show — surface the settled facts
        // (exit price + when it closed) instead of a live-resumes line that would be untrue.
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5 sm:grid-cols-4">
          <Metric label="Entry" value={`$${position.entry_premium.toFixed(2)}`} />
          <Metric
            label="Exit"
            value={position.exit_premium != null ? `$${position.exit_premium.toFixed(2)}` : EM_DASH}
          />
          <Metric label="×Contracts" value={num(position.contracts, 0)} />
          <Metric
            label="Closed"
            value={position.closed_at ? position.closed_at.slice(0, 10) : EM_DASH}
          />
        </div>
      ) : live ? (
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5 sm:grid-cols-4">
          <Metric label="Mark" value={num(position.valuation?.mark)} />
          <Metric label="Δ" value={num(position.valuation?.delta)} />
          <Metric label="Θ/day" value={num(position.valuation?.theta)} />
          <Metric label="IV" value={ivPct(position.valuation?.iv)} />
          <Metric label="DTE" value={num(position.dte, 0)} />
          <Metric label="B/E" value={num(position.breakeven)} />
          <Metric label="Dist→K" value={distToStrike(position.distance_to_strike_pct, position.option_type)} />
          <Metric label="OI" value={num(position.valuation?.openInterest, 0)} />
        </div>
      ) : position.valuation_unavailable_reason === "contract-not-found" ? (
        // An unlisted / expired contract never "resumes at the open" — say so plainly so the
        // card matches the detail modal instead of contradicting it with a false market-open promise.
        <p className="font-mono text-[11px] leading-snug text-sky-300">
          Unlisted contract · no live option chain
        </p>
      ) : (
        <p className="font-mono text-[11px] leading-snug text-sky-300">
          Valuation resumes at market open ·{" "}
          <span className="text-emerald-300">9:30&nbsp;AM ET</span>
        </p>
      )}

      {/* One-line "what to do" — first verdict reason, clamped. Suppressed for settled
          positions (their verdict is the inert "can't judge" placeholder — not actionable). */}
      {!closed && reason && (
        <p className="flex items-start gap-1.5 font-mono text-[11px] leading-snug">
          <span className="line-clamp-2 text-sky-300/90">{reason}</span>
        </p>
      )}

      {actionError && (
        <p role="alert" className="font-mono text-[11px] text-bear">
          {actionError}
        </p>
      )}

      {/* Footer actions — all stopPropagation so they never trigger the card's open-detail click.
          Close opens an inline exit-premium form; Delete a two-step confirm (I-05: no native dialogs).
          "Full intel" is the primary; Close + Delete ghost/danger. */}
      {closeOpen ? (
        <div
          className="mt-auto flex items-center gap-2 pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <label htmlFor={`nw-close-${position.id}`} className="sr-only">
            Exit premium per contract
          </label>
          <input
            id={`nw-close-${position.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            autoFocus
            value={closeExit}
            onChange={(e) => setCloseExit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitClose();
              } else if (e.key === "Escape") {
                setCloseOpen(false);
                setActionError(null);
              }
            }}
            placeholder="Exit / contract"
            className="w-28 rounded border border-cyan-500/30 bg-black/40 px-2 py-1 font-mono text-xs text-white outline-none placeholder:text-sky-300/40 focus:border-cyan-400"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void submitClose();
            }}
            loading={busy === "close"}
            disabled={busy != null}
          >
            Confirm close
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setCloseOpen(false);
              setActionError(null);
            }}
            disabled={busy != null}
          >
            Cancel
          </Button>
        </div>
      ) : confirmDelete ? (
        <div
          className="mt-auto flex items-center gap-2 pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex-1 font-mono text-[11px] text-bear">
            Delete permanently? Can&apos;t be undone.
          </span>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void confirmDeleteAction();
            }}
            loading={busy === "delete"}
            disabled={busy != null}
          >
            Yes, delete
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(false);
              setActionError(null);
            }}
            disabled={busy != null}
          >
            Cancel
          </Button>
        </div>
      ) : (
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
          {/* A settled position can't be re-closed (the PATCH guard requires status='open'),
              so the Close action is hidden for closed cards — only Full intel + Delete remain. */}
          {!closed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openCloseForm();
              }}
              disabled={busy != null}
            >
              Close
            </Button>
          )}
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setActionError(null);
              setConfirmDelete(true);
            }}
            disabled={busy != null}
          >
            Delete
          </Button>
        </div>
      )}
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
// Portfolio Exposure — aggregate Greeks across all LIVE open positions.
//
// Honesty: legs whose valuation_status !== "live" contribute nothing (no greek
// exists to sum). If liveLegs === 0 all cells read "—". Side is signed:
// short positions flip the exposure (negative delta = short, etc.).
// ---------------------------------------------------------------------------
function computePortfolioGreeks(positions: ApiPosition[]): PortfolioGreeks {
  return positions
    .filter((p) => p.status !== "closed" && p.valuation_status === "live" && p.valuation != null)
    .reduce(
      (acc, p) => {
        const sideSign = p.side === "short" ? -1 : 1;
        const size = (p.contracts ?? 1) * sideSign;
        const mult = 100;
        acc.delta += (p.valuation!.delta ?? 0) * size * mult;
        acc.gamma += (p.valuation!.gamma ?? 0) * size * mult;
        acc.theta += (p.valuation!.theta ?? 0) * size * mult;
        acc.vega += (p.valuation!.vega ?? 0) * size * mult;
        acc.totalPremiumAtRisk += (p.valuation!.mark ?? p.entry_premium ?? 0) * Math.abs(size) * mult;
        const spot = p.valuation!.underlyingPrice ?? 5500;
        acc.totalDeltaDollars += (p.valuation!.delta ?? 0) * size * mult * spot;
        acc.liveLegs += 1;
        return acc;
      },
      { delta: 0, gamma: 0, theta: 0, vega: 0, totalPremiumAtRisk: 0, totalDeltaDollars: 0, liveLegs: 0 }
    );
}

function gk(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}`;
}

function PortfolioExposure({ positions }: { positions: ApiPosition[] }) {
  const g = computePortfolioGreeks(positions);
  if (g.liveLegs === 0) return null;

  const deltaClass = g.delta >= 0 ? "text-cyan-400" : "text-red-400";
  const thetaClass = "text-amber-400"; // always decaying — always amber

  const deltaDollars = Math.abs(g.totalDeltaDollars);
  const deltaDollarStr = deltaDollars >= 1000
    ? `$${(deltaDollars / 1000).toFixed(1)}k/pt`
    : `$${deltaDollars.toFixed(0)}/pt`;

  const thetaDay = g.theta; // theta is already per-day from the greeks model
  const thetaDayStr = `${thetaDay < 0 ? "-" : "+"}$${Math.abs(thetaDay).toLocaleString(undefined, { maximumFractionDigits: 0 })}/day`;

  const premRisk = g.totalPremiumAtRisk;
  const premStr = premRisk >= 1000
    ? `$${(premRisk / 1000).toFixed(1)}k`
    : `$${premRisk.toFixed(0)}`;

  return (
    <div className="nighthawk-watch-exposure" aria-label="Portfolio exposure">
      <div className="nighthawk-watch-exposure-grid">
        {/* Net Delta + dollar delta */}
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/70">Net Delta</span>
          <span className={clsx("font-mono text-[13px] font-semibold tabular-nums", deltaClass)}>
            {gk(g.delta, 2)}
          </span>
          <span className={clsx("font-mono text-[10px] tabular-nums", deltaClass, "opacity-70")}>
            {g.delta >= 0 ? "+" : "-"}{deltaDollarStr}
          </span>
        </div>

        {/* Net Gamma */}
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/70">Net Gamma</span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-white">
            {gk(g.gamma, 4)}
          </span>
        </div>

        {/* Net Theta — always amber, always decaying */}
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/70">Net Theta</span>
          <span className={clsx("font-mono text-[13px] font-semibold tabular-nums", thetaClass)}>
            {gk(g.theta, 2)}
          </span>
          <span className={clsx("font-mono text-[10px] tabular-nums", thetaClass, "opacity-70")}>
            {thetaDayStr}
          </span>
        </div>

        {/* Net Vega */}
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/70">Net Vega</span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-white">
            {gk(g.vega, 2)}
          </span>
        </div>
      </div>

      <div className="nighthawk-watch-exposure-footer">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-400">
          Total premium at risk
        </span>
        <span className="font-mono text-[12px] font-semibold tabular-nums text-white">
          {premStr}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coaching alerts panel.
// ---------------------------------------------------------------------------
type AlertUrgency = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type CoachingAlert = {
  id: string;
  generatedAt: string;
  trigger: string;
  alert: string;
  urgency: AlertUrgency;
  spxPrice?: number;
  callWall?: number;
  putWall?: number;
  forLongs?: string;
  forShorts?: string;
};

const URGENCY_CLASSES: Record<AlertUrgency, { border: string; bg: string; text: string; dot: string }> = {
  CRITICAL: {
    border: "border-red-800/40",
    bg: "bg-red-950/30",
    text: "text-red-400",
    dot: "bg-red-400",
  },
  HIGH: {
    border: "border-amber-800/40",
    bg: "bg-amber-950/30",
    text: "text-amber-400",
    dot: "bg-amber-400",
  },
  MEDIUM: {
    border: "border-cyan-800/40",
    bg: "bg-cyan-950/30",
    text: "text-cyan-400",
    dot: "bg-cyan-400",
  },
  LOW: {
    border: "border-sky-800/40",
    bg: "bg-sky-950/30",
    text: "text-sky-300",
    dot: "bg-sky-300",
  },
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type CoachState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; alerts: CoachingAlert[] };

const COACH_POLL_MS = 30_000;

function CoachingAlertsPanel({
  embedded = false,
  onCount,
}: {
  embedded?: boolean;
  onCount?: (count: number) => void;
}) {
  const [state, setState] = useState<CoachState>({ kind: "loading" });
  const loadedOnce = useRef(false);
  const inFlight = useRef(false);
  const pending = useRef(false);
  // Force re-render every 30s so relative timestamps stay fresh.
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    inFlight.current = true;
    try {
      let runAgain = true;
      while (runAgain) {
        pending.current = false;
        const res = await fetch("/api/coaching/alerts", { cache: "no-store" });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setState({ kind: "error", message: data?.error ?? "Failed to load coaching alerts." });
        } else {
          const data = (await res.json()) as { alerts: CoachingAlert[] };
          setState({ kind: "ready", alerts: data.alerts ?? [] });
        }
        loadedOnce.current = true;
        runAgain = pending.current;
      }
    } catch {
      setState({ kind: "error", message: "Network error — could not load coaching alerts." });
      loadedOnce.current = true;
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      void load();
      // Also nudge the timestamp display.
      setTick((n) => n + 1);
      timer = setTimeout(tick, COACH_POLL_MS);
    };
    timer = setTimeout(tick, COACH_POLL_MS);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const alerts = state.kind === "ready" ? state.alerts : [];

  useEffect(() => {
    if (state.kind === "ready") onCount?.(state.alerts.length);
  }, [state, onCount]);

  return (
    <section aria-label="Position Coach" className="flex flex-col gap-3">
      {!embedded && (
        <header className="flex items-center gap-2.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">
            Position Coach
          </span>
          {state.kind === "ready" && alerts.length > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-cyan-400">{alerts.length}</span>
          )}
          <span aria-hidden className="h-px flex-1 bg-white/[0.08]" />
        </header>
      )}

      {/* States */}
      {state.kind === "loading" && !loadedOnce.current ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-[72px] animate-pulse rounded-xl border border-white/[0.07] bg-white/[0.025]"
            />
          ))}
        </div>
      ) : state.kind === "error" ? (
        <p className="font-mono text-[11px] text-bear">{state.message}</p>
      ) : alerts.length === 0 ? (
        <p className="font-mono text-[11px] leading-relaxed text-sky-300/80">
          No active coaching alerts — positions look healthy.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((a) => {
            const styles = URGENCY_CLASSES[a.urgency] ?? URGENCY_CLASSES.LOW;
            return (
              <div
                key={a.id}
                className={clsx(
                  "flex flex-col gap-2 rounded-xl border px-3.5 py-3",
                  styles.border,
                  styles.bg
                )}
              >
                {/* Top row: urgency badge + trigger label + timestamp */}
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]",
                      styles.text,
                      styles.border,
                      styles.bg
                    )}
                  >
                    <span className={clsx("h-1.5 w-1.5 rounded-full", styles.dot)} aria-hidden />
                    {a.urgency}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-sky-300">
                    {a.trigger}
                  </span>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-cyan-400">
                    {relativeTime(a.generatedAt)}
                  </span>
                </div>

                {/* Alert message */}
                <p className="font-mono text-[12px] leading-snug text-white">{a.alert}</p>

                {/* For-longs / for-shorts guidance, if present */}
                {(a.forLongs ?? a.forShorts) && (
                  <div className="grid grid-cols-2 gap-2">
                    {a.forLongs && (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-400">
                          For longs
                        </span>
                        <span className="font-mono text-[11px] leading-snug text-bull">{a.forLongs}</span>
                      </div>
                    )}
                    {a.forShorts && (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-400">
                          For shorts
                        </span>
                        <span className="font-mono text-[11px] leading-snug text-bear-text">
                          {a.forShorts}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
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
  const [coachAlertCount, setCoachAlertCount] = useState<number | null>(null);
  const [closedOpen, setClosedOpen] = useState<boolean | null>(null);
  // Keep a ref so the poll loop never shows a flash of skeleton on refetch.
  const loadedOnce = useRef(false);
  // In-flight mutex: poll + focus + initial + add/delete can all fire load(). We don't stack
  // overlapping fetches (which would multiply upstream load near the ceiling) — but a request that
  // arrives mid-flight must NOT be dropped, or a mutation's refresh is lost. So it sets `pending` and
  // the running load does ONE trailing re-run. (The bug this fixes: adding a position left the list
  // stale until the next poll because onCreated()'s load() hit the mutex and silently returned.)
  const inFlight = useRef(false);
  const pending = useRef(false);

  // SSE stream for real-time P&L — pushes every 3s from the server.
  // Falls back gracefully to the polling loop if SSE is unavailable.
  const { positions: streamPositions, sseConnected } = usePositionStream<ApiPosition>();

  // When SSE delivers a payload, update state immediately (no round-trip needed).
  // The polling loop below remains active as a backup — both can coexist safely.
  useEffect(() => {
    if (streamPositions && streamPositions.length >= 0) {
      setState({ kind: "ready", positions: streamPositions });
      loadedOnce.current = true;
    }
  }, [streamPositions]);

  const load = useCallback(async () => {
    if (inFlight.current) {
      pending.current = true; // coalesce — the in-flight load will re-run once for us
      return;
    }
    inFlight.current = true;
    try {
      let runAgain = true;
      while (runAgain) {
        pending.current = false;
        const res = await fetch("/api/account/positions", { cache: "no-store" });
        if (res.status === 401) {
          setState({ kind: "unauthed" });
        } else if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setState({ kind: "error", message: data?.error ?? "Failed to load positions." });
        } else {
          const data = (await res.json()) as { positions: ApiPosition[]; portfolioGreeks?: PortfolioGreeks };
          setState({ kind: "ready", positions: data.positions ?? [] });
        }
        loadedOnce.current = true;
        runAgain = pending.current; // a caller requested a refresh while we were fetching → re-run
      }
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
  // Split the loaded set: OPEN positions are the live book; CLOSED ones are settled and
  // shown in their own group below. The GET returns open first, then a bounded tail of
  // recently-closed — we re-split here so the header summary + the live grid only ever
  // count OPEN legs (a closed leg must NOT inflate the open count or the unrealized total).
  const openPositions = positions.filter((p) => p.status !== "closed");
  const closedPositions = positions.filter((p) => p.status === "closed");
  const hasPositions = positions.length > 0;
  const hasOpen = openPositions.length > 0;
  const hasClosed = closedPositions.length > 0;
  // The Position coach is the global SPX wall/VWAP coaching feed (coaching_alerts) — it is
  // SPX-specific market guidance, NOT a per-position read. So it is only meaningful when the
  // user is actually holding an SPX-family contract; otherwise it would surface market data
  // unrelated to their book (which reads as "random"). resolveCoachView is the single source
  // of truth for the gating (unit-tested in coach-view.test.ts).
  const holdsSpx = holdsSpxFamily(openPositions.map((p) => p.ticker));
  const coachView = resolveCoachView(hasOpen, holdsSpx);
  // Summary is OPEN-only by construction: passing just the open set means its count, its
  // unrealized P&L sum, its return %, and its verdict tallies all exclude settled legs.
  const summary = ready ? summarize(openPositions) : null;
  // Resolve the collapsible default: collapsed when positions already exist.
  const isFormOpen = formOpen ?? !hasPositions;
  const isClosedOpen = closedOpen ?? !hasOpen;
  const showLive = state.kind === "ready";
  const exposureLegs =
    ready && hasOpen
      ? computePortfolioGreeks(openPositions).liveLegs
      : 0;

  return (
    <section className="nighthawk-watch" aria-label="Night's Watch positions">
      {/* ---- Tier 1: header ---- */}
      <header className="nighthawk-watch-header">
        <div className="min-w-0">
          <p className="nighthawk-watch-kicker">Night&apos;s Watch</p>
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
          {showLive ? (sseConnected ? "Live · SSE" : "Live · updating") : "Connecting"}
        </span>
      </header>

      {/* ---- Scrollable body ---- */}
      <div className="nighthawk-watch-body">
        {summary && hasOpen && (
          <CollapsibleTile
            kicker="Portfolio"
            title="Overview"
            badge={String(summary.count)}
            defaultOpen
            variant="accent"
          >
            {exposureLegs > 0 ? <PortfolioExposure positions={openPositions} /> : null}
            <PortfolioSummary summary={summary} />
          </CollapsibleTile>
        )}

        {(state.kind === "ready" || state.kind === "loading") && (
          <CollapsibleTile
            kicker="Track"
            title="Add position"
            open={isFormOpen}
            onOpenChange={(v) => setFormOpen(v)}
            variant="gold"
          >
            <AddPositionForm
              onCreated={() => {
                void load();
                setFormOpen(false);
              }}
            />
          </CollapsibleTile>
        )}

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
        ) : state.kind === "ready" && !hasPositions ? (
          <EmptyState
            title="Nothing on the watch — yet"
            description="Night's Watch stays dark until you're holding something. Add a position above and the coach wakes up: live P&L, Greeks, and a hold / trim / sell call on every contract."
          />
        ) : state.kind === "ready" ? (
          <>
            {hasOpen ? (
              <CollapsibleTile
                kicker="Live book"
                title="Open positions"
                badge={String(openPositions.length)}
                defaultOpen
              >
                <div className="nighthawk-watch-grid">
                  {openPositions.map((p) => (
                    <PositionCard
                      key={p.id}
                      position={p}
                      onChanged={load}
                      onOpenDetail={setDetailId}
                    />
                  ))}
                </div>
              </CollapsibleTile>
            ) : (
              <p className="font-mono text-[11px] leading-relaxed text-sky-300">
                No open positions — add your first above.
              </p>
            )}

            {hasClosed && (
              <CollapsibleTile
                kicker="Settled"
                title="Closed positions"
                badge={String(closedPositions.length)}
                open={isClosedOpen}
                onOpenChange={(v) => setClosedOpen(v)}
              >
                <div className="nighthawk-watch-grid">
                  {closedPositions.map((p) => (
                    <PositionCard
                      key={p.id}
                      position={p}
                      onChanged={load}
                      onOpenDetail={setDetailId}
                    />
                  ))}
                </div>
              </CollapsibleTile>
            )}
          </>
        ) : null}

        {/* Position coach — strictly tied to the user's OPEN book. With no open positions
            there is nothing to coach, so the tile is hidden and the catchy empty state above
            stands alone (no global market data leaking in). With open positions, the SPX
            wall/VWAP coaching feed only applies to SPX holders; everyone else gets a clear,
            position-grounded note instead of unrelated market alerts. */}
        {coachView !== "hidden" && (
          <CollapsibleTile
            kicker="Alerts"
            title="Position coach"
            badge={
              coachView === "spx-alerts" && coachAlertCount != null && coachAlertCount > 0
                ? String(coachAlertCount)
                : undefined
            }
            defaultOpen={coachView === "spx-alerts" && (coachAlertCount == null || coachAlertCount > 0)}
          >
            {coachView === "spx-alerts" ? (
              <CoachingAlertsPanel embedded onCount={setCoachAlertCount} />
            ) : (
              <p className="font-mono text-[11px] leading-relaxed text-sky-300/80">
                Every contract above carries its own live hold / trim / sell read — that&apos;s
                your coaching. SPX wall &amp; VWAP coaching lights up here the moment you&apos;re
                holding an SPX position.
              </p>
            )}
          </CollapsibleTile>
        )}

        {state.kind === "ready" && (
          <CollapsibleTile kicker="Discord" title="Personal play alerts" defaultOpen={false}>
            <PersonalAlertsSettings />
          </CollapsibleTile>
        )}
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
