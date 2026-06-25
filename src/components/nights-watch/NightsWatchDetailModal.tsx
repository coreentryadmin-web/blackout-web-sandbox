"use client";

// Night's Watch — POSITION DETAIL MODAL.
//
// Clicking a position card opens this popup: the full cross-tool decision intel for ONE
// position, with "WHAT TO DO" front-and-center and a verified-data provenance footer.
//
// CONTRACT: fetch GET /api/account/positions/[id]/detail ONCE per open (cache:"no-store").
// The endpoint is heavier than the list, so there is NO interval poll — only a manual
// "Refresh" button re-fetches. States: loading (Skeleton) · 401 (sign-in) · 404/error
// (EmptyState + Retry) · ready.
//
// HONESTY: never render a fabricated number. A null section renders a quiet "No <x> data"
// line, not a placeholder value. The dataSources[] ledger is the "legit verified data"
// provenance the user asked for — each source shows ok (green check / muted dash) + asOf.
//
// NO grey — bull / bear / sky / gold / mute / white only. Reduced-motion safe (all motion
// is gated inside the design-system primitives). Mobile-friendly: the Modal scrolls and the
// sections stack. Accessible: dialog role + ESC/overlay close come from <Modal>.

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import type {
  PositionDetail,
  PositioningSection,
  FlowsSection,
  TechnicalsSection,
  NewsItem,
  CatalystsSection,
  ConfluenceSection,
  DossierSection,
  DataSource,
} from "@/lib/nights-watch/position-detail";
import type { VerdictAction, VerdictConfidence } from "@/lib/nights-watch/verdict";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export type NightsWatchDetailModalProps = {
  positionId: number;
  open: boolean;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Formatting helpers (mirror the panel's — honest "—" for null).
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

/** Compact dollar magnitude for premium ($1.2m / $340k / $920). No sign. */
function moneyCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
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

/** A price-level number — pretty thousands separators, up to 2 dp. */
function price(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** "Jun 24" / "Jun 24, 2026" from an ISO or YYYY-MM-DD; falls back to the raw string. */
function shortDate(raw: string | null | undefined): string {
  if (!raw) return EM_DASH;
  const t = Date.parse(raw.length <= 10 ? `${raw}T00:00:00Z` : raw);
  if (!Number.isFinite(t)) return raw;
  // Render in UTC: expiry is a plain calendar date parsed as UTC midnight above, so a
  // negative-offset local TZ (e.g. ET) must NOT shift it back a day ("2026-07-17" → "Jul 16").
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Jun 24, 3:14 PM" timestamp for the data ledger. */
function stamp(raw: string | null | undefined): string {
  if (!raw) return EM_DASH;
  const t = Date.parse(raw.length <= 10 ? `${raw}T00:00:00Z` : raw);
  if (!Number.isFinite(t)) return raw;
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// Verdict / action color language.
//   sell → bear · trim → gold · hold → bull · watch → sky
// ---------------------------------------------------------------------------
const ACTION_TEXT: Record<VerdictAction, string> = {
  sell: "text-bear",
  trim: "text-gold",
  hold: "text-bull",
  watch: "text-sky-300",
};
const ACTION_BORDER: Record<VerdictAction, string> = {
  sell: "border-bear/40",
  trim: "border-gold/40",
  hold: "border-bull/40",
  watch: "border-sky-400/40",
};
const ACTION_BG: Record<VerdictAction, string> = {
  sell: "bg-bear/[0.07]",
  trim: "bg-gold/[0.07]",
  hold: "bg-bull/[0.07]",
  watch: "bg-sky-400/[0.06]",
};
const ACTION_GLOW: Record<VerdictAction, string> = {
  sell: "shadow-[0_0_60px_-30px_rgba(255,45,85,0.7)]",
  trim: "shadow-[0_0_60px_-30px_rgba(255,210,63,0.7)]",
  hold: "shadow-[0_0_60px_-30px_rgba(0,230,118,0.7)]",
  watch: "shadow-[0_0_60px_-30px_rgba(56,189,248,0.6)]",
};
const ACTION_LABEL: Record<VerdictAction, string> = {
  sell: "SELL",
  trim: "TRIM",
  hold: "HOLD",
  watch: "WATCH",
};
const CONFIDENCE_LABEL: Record<VerdictConfidence, string> = {
  low: "low confidence",
  medium: "medium confidence",
  high: "high confidence",
};

// ---------------------------------------------------------------------------
// Small shared section primitives
// ---------------------------------------------------------------------------

/** Section wrapper: a kicker header + body, in the house glass card style. */
function Section({
  kicker,
  right,
  children,
}: {
  kicker: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[rgba(8,9,14,0.6)] p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">
          ◆ {kicker}
        </p>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Honest "no data" line for a null section. Quiet, never a fabricated value. */
function NoData({ what }: { what: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-white/10 bg-[rgba(8,9,14,0.4)] px-4 py-3">
      <p className="font-mono text-[11px] tracking-[0.04em] text-mute">No {what} data</p>
    </section>
  );
}

/** Labelled metric cell. */
function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-mute">{label}</span>
      <span className={clsx("font-mono text-[13px] tabular-nums", tone ?? "text-white")}>
        {value}
      </span>
    </div>
  );
}

/** A labelled price chip (used for "levels to watch" + key levels). */
function LevelChip({
  label,
  value,
  tone = "sky",
}: {
  label: string;
  value: string;
  tone?: "sky" | "bull" | "bear" | "gold" | "white";
}) {
  const TONE: Record<string, string> = {
    sky: "border-sky-400/30 bg-sky-400/[0.08] text-sky-300",
    bull: "border-bull/35 bg-bull/[0.08] text-bull",
    // Small chip text → AA-safe --bear-text (#ff5c78) rather than display --bear.
    bear: "border-bear/35 bg-bear/[0.08] text-bear-text",
    gold: "border-gold/35 bg-gold/[0.08] text-gold",
    // Breakeven / structurally-neutral price markers — high-contrast white.
    white: "border-white/20 bg-white/[0.06] text-white",
  };
  return (
    <div
      className={clsx(
        "flex flex-col gap-0.5 rounded-lg border px-3 py-2 tabular-nums",
        TONE[tone]
      )}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] opacity-80">{label}</span>
      <span className="font-mono text-[14px] font-semibold">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — ticker · strike+C/P · expiry · side · contracts@entry + live P&L
// ---------------------------------------------------------------------------
function DetailHeader({ position }: { position: PositionDetail["position"] }) {
  const live = position.valuation_status === "live";
  const pnl = position.unrealized_pnl;
  const pnlTone = pnl != null && pnl >= 0 ? "text-bull" : "text-bear";
  const statusTone: "bull" | "sky" | "bear" =
    position.valuation_status === "live"
      ? "bull"
      : position.valuation_status === "pending"
        ? "sky"
        : "bear";

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-syne text-[22px] font-bold tracking-tight text-white">
            {position.ticker}
          </span>
          {/* CALL strike/type emerald, PUT bear — direction (call/put), not side.
              Small inline text → AA-safe --bear-text (mirrors the position card). */}
          <span
            className={clsx(
              "font-mono text-[15px] font-semibold tabular-nums",
              position.option_type === "call" ? "text-bull" : "text-bear-text"
            )}
          >
            {position.strike}
            {position.option_type === "call" ? "C" : "P"}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-mute">
          <span>{shortDate(position.expiry)}</span>
          <span aria-hidden>·</span>
          <span className={position.side === "long" ? "text-sky-300" : "text-bear"}>
            {position.side}
          </span>
          <span aria-hidden>·</span>
          <span className="text-white/80">
            {position.contracts}× @ {position.entry_premium}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-mute">
          Unrealized P&amp;L
        </span>
        {live ? (
          <span className={clsx("font-mono text-[22px] font-bold tabular-nums", pnlTone)}>
            {money(pnl)}
          </span>
        ) : (
          <span className="font-mono text-[22px] font-bold tabular-nums text-mute">{EM_DASH}</span>
        )}
        <div className="flex items-center gap-2">
          {live && (
            <span className={clsx("font-mono text-[13px] font-semibold tabular-nums", pnlTone)}>
              {pct(position.pnl_pct)}
            </span>
          )}
          <Badge tone={statusTone} size="sm" dot={live}>
            {position.valuation_status}
          </Badge>
        </div>
        {/* #7b truth: a day-old session-close mark (illiquid/overnight) must not present as a live
            valuation — the P&L above is driven off it, so label it honestly. */}
        {live && position.mark_is_day_close && (
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-amber-300/90">
            prior close · not live
          </span>
        )}
      </div>
    </div>
  );
}

// Semantic tone for a "levels to watch" chip, derived from its label so each
// price reads its own meaning instead of a flat wall of amber:
//   Support / put wall (acting as support) / target  → bull (emerald)
//   Resistance / call wall / stop                    → bear
//   Gamma flip / max pain / entry (neutral markers)  → sky
//   Breakeven                                        → white
// Wall labels carry their RESOLVED role ("acting as support/resistance",
// cross-tool fix #80), so we key on the role words, not raw call/put.
function levelTone(label: string): "bull" | "bear" | "sky" | "white" {
  const l = label.toLowerCase();
  if (l.includes("breakeven")) return "white";
  // Resolved role wins for walls ("call wall (acting as support)" → support).
  if (l.includes("support")) return "bull";
  if (l.includes("resistance")) return "bear";
  if (l.includes("stop")) return "bear";
  if (l.includes("target")) return "bull";
  // Neutral structural markers + entry.
  return "sky";
}

// ---------------------------------------------------------------------------
// WHAT TO DO — the visual centerpiece (verdict hero + levels to watch).
// ---------------------------------------------------------------------------
function WhatToDo({
  whatToDo,
  verdict,
}: {
  whatToDo: PositionDetail["whatToDo"];
  verdict: PositionDetail["position"]["verdict"];
}) {
  const action = whatToDo.action;
  return (
    <div
      className={clsx(
        "rounded-2xl border p-5",
        ACTION_BORDER[action],
        ACTION_BG[action],
        ACTION_GLOW[action]
      )}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">◆ What to do</p>

      {/* Big action + confidence */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className={clsx(
            "font-anton text-[42px] leading-none tracking-tight md:text-[52px]",
            ACTION_TEXT[action]
          )}
        >
          {ACTION_LABEL[action]}
        </span>
        <span
          className={clsx(
            "rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]",
            ACTION_BORDER[action],
            ACTION_TEXT[action]
          )}
        >
          {CONFIDENCE_LABEL[verdict.confidence]}
        </span>
      </div>

      {/* Headline + directive */}
      <p className="mt-3 font-syne text-[16px] font-semibold text-white">{whatToDo.headline}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-sky-300/90">{whatToDo.directive}</p>

      {/* Reasons the verdict fired on */}
      {verdict.reasons.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {verdict.reasons.map((reason, i) => (
            <li key={i} className="flex gap-2 text-[12px] leading-snug text-white/85">
              <span aria-hidden className={clsx("shrink-0", ACTION_TEXT[action])}>
                ◆
              </span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Levels to watch */}
      {whatToDo.levelsToWatch.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-gold">
            Levels to watch
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {whatToDo.levelsToWatch.map((lvl, i) => (
              <LevelChip
                key={i}
                label={lvl.label}
                value={price(lvl.price)}
                tone={levelTone(lvl.label)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desk narrative — grounded Claude synthesis (rendered ONLY when available;
// absent → the deterministic WhatToDo above is the fallback).
// ---------------------------------------------------------------------------
function DeskNarrative({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-gold/25 bg-gradient-to-br from-gold/[0.06] to-bull/[0.04] p-3.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold/80">
        ◆ Desk read · Claude, grounded in verified signals
      </p>
      <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-sky-100/90">{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Positioning / GEX
// ---------------------------------------------------------------------------
function PositioningView({ data }: { data: PositioningSection }) {
  const regime = data.gammaRegime ?? data.regime;
  return (
    <Section
      kicker="Positioning / GEX"
      right={
        regime ? (
          <Badge tone="neutral" size="sm">
            {regime}
          </Badge>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">
        <Metric label="Underlying" value={price(data.underlyingPrice)} />
        <Metric label="Gamma flip" value={price(data.gammaFlip)} />
        <Metric label="Max pain" value={price(data.maxPain)} />
        <Metric label="King strike" value={price(data.kingStrike)} tone="text-gold" />
      </div>

      {data.walls.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mute">
            GEX walls
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.walls.map((w, i) => {
              // Label/tone by net_gex SIGN (put wall = support = green), matching the
              // "Levels to watch" chips (gexWallLabel) and the canonical Heatmap — NOT
              // the geometric w.kind, which contradicted itself on the same strike (#80).
              const hasSign = Number.isFinite(w.net_gex) && w.net_gex !== 0;
              const isPut = w.net_gex < 0; // negative net-gamma => put wall (support)
              const base = isPut ? "Put wall" : "Call wall";
              const nativeRole = isPut ? "support" : "resistance";
              const label = !hasSign
                ? w.kind === "support"
                  ? "Support wall"
                  : "Resistance wall"
                : w.kind === nativeRole
                  ? base
                  : `${base} (acting as ${w.kind})`;
              const tone = !hasSign ? (w.kind === "support" ? "bull" : "bear") : isPut ? "bull" : "bear";
              return <LevelChip key={i} label={label} value={price(w.strike)} tone={tone} />;
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------
const LEAN_TONE: Record<FlowsSection["lean"], "bull" | "bear" | "neutral" | "sky"> = {
  bullish: "bull",
  bearish: "bear",
  mixed: "neutral",
  neutral: "sky",
};

function FlowsView({ data }: { data: FlowsSection }) {
  return (
    <Section
      kicker={`Flows · last ${data.sinceHours}h`}
      right={
        <Badge tone={LEAN_TONE[data.lean]} size="sm">
          {data.lean}
        </Badge>
      }
    >
      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        <Metric label="Call premium" value={moneyCompact(data.callPremium)} tone="text-bull" />
        <Metric label="Put premium" value={moneyCompact(data.putPremium)} tone="text-bear" />
        <Metric label="Prints" value={num(data.count, 0)} />
      </div>

      {data.topStrikes.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mute">
            Top strikes by premium
          </p>
          <ul className="flex flex-col gap-1">
            {data.topStrikes.map((s, i) => {
              const isCall = s.option_type.toUpperCase().startsWith("C");
              return (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5"
                >
                  <span className="flex items-center gap-2 font-mono text-[12px] tabular-nums">
                    <span className={isCall ? "text-bull" : "text-bear"}>
                      {price(s.strike)}
                      {isCall ? "C" : "P"}
                    </span>
                    <span className="text-mute">{shortDate(s.expiry)}</span>
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-white/80">
                    {moneyCompact(s.premium)}
                    <span className="text-mute"> · {s.count}×</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Technicals
// ---------------------------------------------------------------------------
const TREND_TONE: Record<"up" | "down" | "sideways", "bull" | "bear" | "neutral"> = {
  up: "bull",
  down: "bear",
  sideways: "neutral",
};
const TREND_LABEL: Record<"up" | "down" | "sideways", string> = {
  up: "uptrend",
  down: "downtrend",
  sideways: "sideways",
};

function TimeframeRow({
  label,
  tf,
}: {
  label: string;
  tf: { support: number | null; resistance: number | null; vwap: number | null };
}) {
  if (tf.support == null && tf.resistance == null && tf.vwap == null) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 font-mono text-[11px] tabular-nums">
      <span className="uppercase tracking-[0.12em] text-mute">{label}</span>
      <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-white/80">
        <span>
          <span className="text-mute">S</span> {price(tf.support)}
        </span>
        <span>
          <span className="text-mute">R</span> {price(tf.resistance)}
        </span>
        <span>
          <span className="text-mute">VWAP</span> {price(tf.vwap)}
        </span>
      </span>
    </div>
  );
}

function TechnicalsView({ data }: { data: TechnicalsSection }) {
  return (
    <Section
      kicker="Technicals"
      right={
        data.trend ? (
          <Badge tone={TREND_TONE[data.trend]} size="sm">
            {TREND_LABEL[data.trend]}
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm">
            {data.trendStack}
          </Badge>
        )
      }
    >
      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        <Metric label="Price" value={price(data.price)} />
        <Metric label="ATR(14)" value={num(data.atr14)} />
        <Metric label="RSI(d)" value={num(data.rsi.daily, 0)} />
        <Metric label="EMA 20" value={price(data.emas.ema20)} />
        <Metric label="EMA 50" value={price(data.emas.ema50)} />
        <Metric label="EMA 200" value={price(data.emas.ema200)} />
        <Metric label="RSI(1h)" value={num(data.rsi.hourly, 0)} />
        <Metric label="RSI(15m)" value={num(data.rsi.m15, 0)} />
        <Metric
          label="20d range"
          value={
            data.range_low_20d == null && data.range_high_20d == null
              ? EM_DASH
              : `${price(data.range_low_20d)}–${price(data.range_high_20d)}`
          }
        />
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <TimeframeRow label="Daily" tf={data.timeframes.daily} />
        <TimeframeRow label="Hourly" tf={data.timeframes.hourly} />
        <TimeframeRow label="15m" tf={data.timeframes.m15} />
      </div>

      {data.keyLevels.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mute">
            Key levels in path
          </p>
          <div className="grid grid-cols-2 gap-2">
            {data.keyLevels.map((lvl, i) => (
              <LevelChip
                key={i}
                label={`${titleCase(lvl.kind)} · ${lvl.source}`}
                value={price(lvl.price)}
                tone={lvl.kind === "support" ? "bull" : "bear"}
              />
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------
function sentimentTone(s: string | null | undefined): "bull" | "bear" | "neutral" | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.includes("positive") || v.includes("bull")) return "bull";
  if (v.includes("negative") || v.includes("bear")) return "bear";
  return "neutral";
}

function NewsView({ items }: { items: NewsItem[] }) {
  return (
    <Section kicker="News">
      <ul className="flex flex-col gap-2">
        {items.slice(0, 6).map((n, i) => {
          const tone = sentimentTone(n.sentiment);
          return (
            <li
              key={i}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
            >
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-medium leading-snug text-white underline-offset-2 hover:text-sky-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                {n.title}
              </a>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em] text-mute">
                {n.publisher && <span>{n.publisher}</span>}
                {n.publisher && n.published && <span aria-hidden>·</span>}
                {n.published && <span>{shortDate(n.published)}</span>}
                {tone && (
                  <Badge tone={tone} size="sm">
                    {n.sentiment}
                  </Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Catalysts
// ---------------------------------------------------------------------------
function CatalystsView({ data }: { data: CatalystsSection }) {
  return (
    <Section kicker="Catalysts">
      <div className="flex flex-wrap items-center gap-3">
        <Metric label="Earnings" value={shortDate(data.earningsDate)} />
        {data.daysToEarnings != null && (
          <Metric label="In" value={`${data.daysToEarnings} days`} />
        )}
        {data.beforeExpiry === true && (
          <Badge tone="bear" size="md">
            Before expiry
          </Badge>
        )}
        {data.beforeExpiry === false && (
          <Badge tone="neutral" size="sm">
            After expiry
          </Badge>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Confluence (SPX only)
// ---------------------------------------------------------------------------
function ConfluenceView({ data }: { data: ConfluenceSection }) {
  const biasTone: "bull" | "bear" | "neutral" =
    data.bias === "bullish" ? "bull" : data.bias === "bearish" ? "bear" : "neutral";
  return (
    <Section
      kicker="SPX confluence"
      right={
        <div className="flex items-center gap-1.5">
          <Badge tone={biasTone} size="sm">
            {data.bias}
          </Badge>
          <Badge tone="neutral" size="sm">
            {data.grade} · {data.score}
          </Badge>
        </div>
      }
    >
      <p className="font-syne text-[14px] font-semibold text-white">{data.headline}</p>
      {data.thesis && (
        <p className="mt-1 text-[12px] leading-relaxed text-sky-300/85">{data.thesis}</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {data.entry != null && <LevelChip label="Entry" value={price(data.entry)} tone="sky" />}
        {data.stop != null && <LevelChip label="Stop" value={price(data.stop)} tone="bear" />}
        {data.target != null && <LevelChip label="Target" value={price(data.target)} tone="bull" />}
      </div>

      {data.invalidation && (
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-mute">
          <span className="text-bear">Invalidation:</span> {data.invalidation}
        </p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Dossier (Night Hawk)
// ---------------------------------------------------------------------------
/** Pull a plain-English summary string out of the dossier blob, best-effort. */
function dossierSummary(d: DossierSection): string | null {
  const blob = d.dossier as Record<string, unknown>;
  for (const key of ["summary", "thesis", "headline", "narrative", "overview"]) {
    const v = blob[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function DossierView({ data }: { data: DossierSection }) {
  const summary = dossierSummary(data);
  return (
    <Section
      kicker="Night Hawk dossier"
      right={
        <Badge tone="neutral" size="sm">
          {shortDate(data.edition_for)}
        </Badge>
      }
    >
      {summary ? (
        <p className="text-[13px] leading-relaxed text-white/85">{summary}</p>
      ) : (
        <p className="font-mono text-[11px] text-mute">
          Dossier staged for {data.ticker} — open Night Hawk for the full write-up.
        </p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Verified-data footer — the dataSources[] provenance ledger.
// ---------------------------------------------------------------------------
function DataSourcesLedger({ sources, asOf }: { sources: DataSource[]; asOf: string }) {
  return (
    <section className="rounded-2xl border border-bull/20 bg-bull/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-bull">
          ◆ Verified data sources
        </p>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-mute">
          as of {stamp(asOf)}
        </span>
      </div>

      <ul className="flex flex-col divide-y divide-white/[0.06]">
        {sources.map((s) => (
          <li key={s.key} className="flex items-center gap-3 py-2">
            {/* ok indicator: green check / muted dash */}
            <span
              aria-hidden
              className={clsx(
                "grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                s.ok
                  ? "border-bull/40 bg-bull/10 text-bull"
                  : "border-white/10 bg-white/[0.03] text-mute"
              )}
            >
              {s.ok ? "✓" : "–"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[12px] text-white">{s.label}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
                {s.provider}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-sky-300/80">
              {s.ok ? (
                <span className="sr-only">verified</span>
              ) : (
                <span className="sr-only">no data</span>
              )}
              {s.asOf ? stamp(s.asOf) : <span className="text-mute">{EM_DASH}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------
type State =
  | { kind: "loading" }
  | { kind: "unauthed" }
  | { kind: "notfound" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: PositionDetail };

function LoadingBody() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton height={56} />
      <Skeleton height={160} rounded="2xl" />
      <Skeleton height={120} rounded="2xl" />
      <Skeleton height={120} rounded="2xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The modal
// ---------------------------------------------------------------------------
export function NightsWatchDetailModal({
  positionId,
  open,
  onClose,
}: NightsWatchDetailModalProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

  // Fetch ONCE per open (cache:"no-store"). No interval poll — the endpoint is heavier;
  // the contract is one fetch per open + a manual Refresh.
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    // 25s timeout so a hung backend (the detail aggregates several upstreams + Claude) can't
    // leave an infinite spinner holding a connection.
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const res = await fetch(`/api/account/positions/${positionId}/detail`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (res.status === 401) {
        setState({ kind: "unauthed" });
        return;
      }
      if (res.status === 404) {
        setState({ kind: "notfound" });
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ kind: "error", message: data?.error ?? "Failed to load position detail." });
        return;
      }
      const detail = (await res.json()) as PositionDetail;
      setState({ kind: "ready", detail });
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "Timed out loading position detail — try Refresh."
          : "Network error — could not load position detail.";
      setState({ kind: "error", message: msg });
    } finally {
      clearTimeout(to);
    }
  }, [positionId]);

  // Fetch when the modal opens (or the target position changes while open).
  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const ready = state.kind === "ready" ? state.detail : null;

  const title = (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-bull">
        ◆ Night&apos;s Watch
      </span>
      <span className="font-syne text-[15px] font-semibold text-white">Position detail</span>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      {/* Action row: Refresh (manual re-fetch — NOT a poll) */}
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          loading={state.kind === "loading"}
          disabled={state.kind === "loading"}
        >
          Refresh
        </Button>
      </div>

      {state.kind === "loading" ? (
        <LoadingBody />
      ) : state.kind === "unauthed" ? (
        <EmptyState
          icon="◆"
          title="Sign in to view this position"
          description="Night's Watch keeps your positions private to your account. Sign in to see the full decision intel."
          action={
            <Button href="/sign-in" variant="primary" size="sm">
              Sign in
            </Button>
          }
        />
      ) : state.kind === "notfound" ? (
        <EmptyState
          icon="!"
          title="Position not found"
          description="This position no longer exists — it may have been closed or deleted."
          action={
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          }
        />
      ) : state.kind === "error" ? (
        <EmptyState
          icon="!"
          title="Couldn't load the detail"
          description={state.message}
          action={
            <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : ready ? (
        <div className="flex flex-col gap-4">
          {/* 1) Header */}
          <DetailHeader position={ready.position} />

          {/* 2) WHAT TO DO — centerpiece */}
          <WhatToDo whatToDo={ready.whatToDo} verdict={ready.position.verdict} />

          {/* 2b) Grounded Claude desk narrative — only when available (else WhatToDo stands alone) */}
          {ready.narrative ? <DeskNarrative text={ready.narrative} /> : null}

          {/* 3) Positioning / GEX */}
          {ready.sections.positioning ? (
            <PositioningView data={ready.sections.positioning} />
          ) : (
            <NoData what="positioning" />
          )}

          {/* 4) Flows */}
          {ready.sections.flows ? (
            <FlowsView data={ready.sections.flows} />
          ) : (
            <NoData what="flow" />
          )}

          {/* 5) Technicals */}
          {ready.sections.technicals ? (
            <TechnicalsView data={ready.sections.technicals} />
          ) : (
            <NoData what="technicals" />
          )}

          {/* 6) News */}
          {ready.sections.news && ready.sections.news.length > 0 ? (
            <NewsView items={ready.sections.news} />
          ) : (
            <NoData what="news" />
          )}

          {/* 7) Catalysts */}
          {ready.sections.catalysts ? (
            <CatalystsView data={ready.sections.catalysts} />
          ) : (
            <NoData what="catalyst" />
          )}

          {/* 8) Confluence (SPX only — null otherwise, shown only when present) */}
          {ready.sections.confluence && (
            <ConfluenceView data={ready.sections.confluence} />
          )}

          {/* 9) Dossier (only when staged) */}
          {ready.sections.dossier && <DossierView data={ready.sections.dossier} />}

          {/* 10) Verified-data footer */}
          <DataSourcesLedger sources={ready.dataSources} asOf={ready.as_of} />

          {/* 11) Persistent disclaimer */}
          <p className="font-mono text-[10px] leading-relaxed text-mute">
            Analysis from BlackOut&apos;s tools — not financial advice. You decide.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
