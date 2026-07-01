"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";
import type { MarketStatusLabel } from "@/lib/spx-market-session";
import { ProductMark } from "@/components/marks/ProductMark";
import { FreshnessChip, Kicker, type FreshnessStatus } from "@/components/ui";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
};

function resolveFreshness(
  live: boolean | undefined,
  feedStalled: boolean,
  isStale: boolean,
  asOf: Date | null
): { status: FreshnessStatus; asOf: Date | null } {
  if (!live) return { status: "offline", asOf };
  if (feedStalled) return { status: "stale", asOf };
  if (isStale) return { status: "stale", asOf };
  return { status: "live", asOf };
}

export function SpxSniperHeader({ desk, live }: Props) {
  const bull = (desk?.spx_change_pct ?? 0) >= 0;

  const polledAtMs = desk?.polled_at
    ? new Date(desk.polled_at).getTime()
    : desk?.as_of
      ? new Date(desk.as_of).getTime()
      : 0;
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  const isStale = Boolean(live && polledAtMs > 0 && nowMs - polledAtMs > 90_000);
  const feedStalled = Boolean(live && desk?.feed_stalled);
  const asOfRaw = desk?.polled_at ?? desk?.as_of;
  const asOf = asOfRaw ? new Date(asOfRaw) : null;
  const freshness = resolveFreshness(live, feedStalled, isStale, asOf);

  return (
    <header className="spx-sniper-command border-b border-white/[0.06] pb-6">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
        <div className="flex flex-col lg:flex-row lg:items-end gap-6 min-w-0 flex-1">
          <div className="shrink-0 flex items-start gap-3">
            <ProductMark product="spx" size={44} title="SPX Slayer" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <Kicker className="mb-1.5">SPX · 0DTE desk</Kicker>
              <h1 className="font-syne text-2xl font-bold tracking-tight text-white md:text-3xl">
                SPX Slayer
              </h1>
              <p className="mt-1 font-mono text-[11px] tracking-[0.08em] text-secondary">
                GEX structure · dealer positioning · session levels
              </p>
            </div>
          </div>

          <div className="min-w-0">
            <AnimatePresence mode="popLayout">
              <motion.p
                key={`${desk?.price ?? 0}-${asOfRaw ?? ""}`}
                initial={{ opacity: 0.85 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className={clsx(
                  "t-num text-5xl font-semibold leading-none sm:text-6xl md:text-7xl",
                  bull ? "text-bull" : "text-bear-text"
                )}
              >
                {live ? fmtPrice(desk?.price ?? null, 2) : "— — —"}
              </motion.p>
            </AnimatePresence>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  "t-num text-base font-semibold md:text-lg",
                  bull ? "text-bull" : "text-bear-text"
                )}
              >
                {live ? fmtPct(desk?.spx_change_pct ?? null) : "—"}
              </span>
              <StatPill label="VIX" value={live && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"} tone="orange" />
              <StatPill
                label="VWAP"
                value={live ? fmtPrice(desk?.vwap ?? null) : "—"}
                tone={desk?.above_vwap ? "bull" : "bear"}
              />
              <StatPill
                label="GEX"
                value={live && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
                tone={(desk?.gex_net ?? 0) >= 0 ? "bull" : "bear"}
              />
            </div>
          </div>

          <div className="spx-hero-metric-blocks">
            <MetricBlock title="EMA" tone="orange">
              <MetricRow label="20" value={live ? fmtPrice(desk?.ema20 ?? null) : "—"} tone="orange" />
              <MetricRow label="50" value={live ? fmtPrice(desk?.ema50 ?? null) : "—"} tone="magenta" />
              <MetricRow label="200" value={live ? fmtPrice(desk?.ema200 ?? null) : "—"} tone="cyan" />
            </MetricBlock>
            <MetricBlock title="SMA" tone="violet">
              <MetricRow label="50" value={live ? fmtPrice(desk?.sma50 ?? null) : "—"} tone="orange" />
              <MetricRow label="200" value={live ? fmtPrice(desk?.sma200 ?? null) : "—"} tone="cyan" />
            </MetricBlock>
            <MetricBlock title="Session" tone="bull">
              <div className="spx-hero-metric-pair">
                <MetricRow label="HOD" value={live ? fmtPrice(desk?.hod ?? null) : "—"} tone="resistance" compact />
                <MetricRow label="PDH" value={live ? fmtPrice(desk?.pdh ?? null) : "—"} tone="resistance" compact />
              </div>
              <div className="spx-hero-metric-pair">
                <MetricRow label="LOD" value={live ? fmtPrice(desk?.lod ?? null) : "—"} tone="support" compact />
                <MetricRow label="PDL" value={live ? fmtPrice(desk?.pdl ?? null) : "—"} tone="support" compact />
              </div>
            </MetricBlock>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 xl:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <MarketStatusPill label={desk?.market_label} />
            <FreshnessChip status={freshness.status} asOf={freshness.asOf} />
            {live && desk?.gex_stale && (
              <span className="rounded border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-200">
                GEX stale
              </span>
            )}
          </div>
          <div className="grid w-full min-w-[200px] grid-cols-2 gap-2 sm:grid-cols-4 xl:w-auto">
            <StatPill label="Regime" value={live ? (desk?.regime ?? "—") : "—"} tone="violet" capitalize />
            <StatPill label="γ Flip" value={live && desk?.gamma_flip ? fmtPrice(desk.gamma_flip) : "—"} tone="magenta" />
            <StatPill label="Max Pain" value={live ? fmtPrice(desk?.max_pain ?? null) : "—"} tone="cyan" />
            <StatPill
              label="IV Rank"
              value={live && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"}
              tone="gold"
            />
          </div>
        </div>
      </div>
    </header>
  );
}

const PILL_BORDER: Record<string, string> = {
  bull: "border-emerald-500/40",
  bear: "border-rose-500/40",
  support: "border-emerald-500/35",
  resistance: "border-rose-500/35",
  orange: "border-orange-500/40",
  violet: "border-violet-500/40",
  magenta: "border-fuchsia-500/40",
  cyan: "border-cyan-500/40",
  gold: "border-gold/40",
  neutral: "border-white/10",
};

const VALUE_TONE: Record<string, string> = {
  bull: "text-emerald-300",
  bear: "text-rose-300",
  support: "text-emerald-300",
  resistance: "text-rose-300",
  orange: "text-orange-300",
  violet: "text-violet-200",
  magenta: "text-fuchsia-300",
  cyan: "text-cyan-300",
  gold: "text-gold",
  neutral: "text-white",
};

const BLOCK_BORDER: Record<string, string> = {
  bull: "border-emerald-500/35",
  orange: "border-orange-500/35",
  violet: "border-violet-500/40",
};

const MARKET_PILL: Record<MarketStatusLabel, string> = {
  "RTH OPEN": "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
  "PRE-MARKET": "border-gold/50 bg-gold/10 text-gold",
  EXTENDED: "border-orange-500/50 bg-orange-500/10 text-orange-200",
  CLOSED: "border-white/10 bg-white/[0.03] text-secondary",
};

function MarketStatusPill({ label }: { label?: string }) {
  const key = (label ?? "CLOSED") as MarketStatusLabel;
  return (
    <span
      className={clsx(
        "rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
        MARKET_PILL[key] ?? MARKET_PILL.CLOSED
      )}
    >
      {label ?? "—"}
    </span>
  );
}

function MetricBlock({
  title,
  tone = "bull",
  children,
}: {
  title: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx("spx-hero-metric-block", BLOCK_BORDER[tone] ?? BLOCK_BORDER.bull)}>
      <p className="spx-hero-metric-block-title">{title}</p>
      <div className="spx-hero-metric-block-body">{children}</div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  tone = "neutral",
  compact,
}: {
  label: string;
  value: string;
  tone?: string;
  compact?: boolean;
}) {
  return (
    <div className={clsx("spx-hero-metric-row", compact && "spx-hero-metric-row-compact")}>
      <span className="spx-hero-metric-row-label">{label}</span>
      <span className={clsx("spx-hero-metric-row-value t-num", VALUE_TONE[tone] ?? VALUE_TONE.neutral)}>
        {value}
      </span>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone = "neutral",
  capitalize: cap,
}: {
  label: string;
  value: string;
  tone?: string;
  capitalize?: boolean;
}) {
  return (
    <div className={clsx("spx-hero-stat-pill", PILL_BORDER[tone] ?? PILL_BORDER.neutral)}>
      <p className="spx-hero-stat-label">{label}</p>
      <p className={clsx("spx-hero-stat-value t-num", cap && "capitalize", VALUE_TONE[tone] ?? VALUE_TONE.neutral)}>
        {value}
      </p>
    </div>
  );
}
