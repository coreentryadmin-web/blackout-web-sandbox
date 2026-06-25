"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";
import type { MarketStatusLabel } from "@/lib/spx-market-session";
import { ProductMark } from "@/components/marks/ProductMark";
import { Kicker } from "@/components/ui";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
};

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
  const isStale = live && polledAtMs > 0 && (nowMs - polledAtMs) > 90_000;
  // Gap #11: the index WS feed can sit OPEN while frozen (TCP half-open), so a non-zero price
  // is shown as live while actually stuck. desk.feed_stalled is set server-side once the SPX
  // index tick age exceeds the feed-stall window; surface it so the price reads NOT-live.
  const feedStalled = Boolean(live && desk?.feed_stalled);

  return (
    <header className="spx-sniper-command">
      <div className="spx-sniper-command-grid" aria-hidden />
      <div className="spx-sniper-command-glow" aria-hidden />
      <div className="spx-sniper-command-scan" aria-hidden />
      <div className="relative z-10">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
          <div className="flex flex-col lg:flex-row lg:items-end gap-5 lg:gap-6 min-w-0 flex-1">
            <div className="shrink-0 flex items-start gap-3">
              <ProductMark
                product="spx"
                size={52}
                hero
                title="SPX Slayer"
                className="mt-1 shrink-0 drop-shadow-[0_0_24px_rgba(0,230,118,0.35)]"
              />
              <div className="min-w-0">
                <Kicker className="mb-1">0DTE COMMAND DESK</Kicker>
                <h1 className="spx-sniper-title">
                  <span className="text-stroke-green">SPX</span>
                  <span className="text-white">-</span>
                  <span className="text-gradient-fire">SLAYER</span>
                </h1>
                <p className="spx-hero-tagline font-mono text-[10px] tracking-[0.32em] uppercase mt-1.5">
                  The 0DTE command desk
                </p>
              </div>
            </div>

            <div className="min-w-0">
              <AnimatePresence mode="popLayout">
                <motion.p
                  key={`${desk?.price ?? 0}-${desk?.polled_at ?? desk?.as_of ?? ""}`}
                  initial={{ opacity: 0.5, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={clsx(
                    "font-anton text-5xl sm:text-6xl md:text-7xl text-white leading-none tabular-nums",
                    bull ? "text-glow-green" : "text-glow-red"
                  )}
                >
                  {live ? fmtPrice(desk?.price ?? null, 2) : "— — —"}
                </motion.p>
              </AnimatePresence>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span
                  className={clsx(
                    "font-mono text-lg font-bold tabular-nums",
                    bull ? "num-bull" : "num-bear"
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

          <div className="flex flex-col items-start xl:items-end gap-3 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <MarketStatusPill label={desk?.market_label} live={live} />
              <span
                className={clsx(
                  "spx-command-live",
                  live && !feedStalled && "spx-command-live-on animate-pulse",
                  feedStalled && "border-gold/60 text-gold"
                )}
              >
                <span className={clsx("badge-live-dot", live && !feedStalled && "animate-pulse")} />
                {feedStalled
                  ? "Feed stalled"
                  : live
                  ? "Live Fire"
                  : desk?.market_label === "CLOSED"
                  ? "Session closed"
                  : "Standby"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full xl:w-auto min-w-[200px]">
              <StatPill label="Regime" value={live ? (desk?.regime ?? "—") : "—"} tone="violet" hot />
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

        {live && (desk?.polled_at ?? desk?.as_of) && (
          <p className="spx-hero-desk-tick mt-4 font-mono text-[10px] tracking-wider flex items-center gap-2">
            {feedStalled ? (
              <span className="text-gold font-semibold text-xs animate-pulse">
                FEED STALLED · price not live
              </span>
            ) : isStale ? (
              <span className="text-gold font-semibold text-xs animate-pulse">STALE</span>
            ) : (
              <span className="text-sky-300 text-xs">
                Desk ·{" "}
                {new Date(desk?.polled_at ?? desk?.as_of ?? "").toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}
          </p>
        )}
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
  neutral: "border-sky-900/50",
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
  CLOSED: "border-sky-300/25 bg-sky-300/[0.06] text-sky-300",
};

function MarketStatusPill({ label, live }: { label?: string; live?: boolean }) {
  const key = (label ?? "CLOSED") as MarketStatusLabel;
  return (
    <span
      className={clsx(
        "font-mono text-[10px] uppercase tracking-[0.2em] px-2.5 py-1 rounded border",
        MARKET_PILL[key] ?? MARKET_PILL.CLOSED,
        live && key === "RTH OPEN" && "animate-pulse"
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
      <span className={clsx("spx-hero-metric-row-value", VALUE_TONE[tone] ?? VALUE_TONE.neutral)}>
        {value}
      </span>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone = "neutral",
  hot,
  capitalize: cap,
}: {
  label: string;
  value: string;
  tone?: string;
  hot?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div
      className={clsx(
        "spx-hero-stat-pill",
        PILL_BORDER[tone] ?? PILL_BORDER.neutral,
        hot && "spx-stat-pill-glow"
      )}
    >
      <p className="spx-hero-stat-label">{label}</p>
      <p className={clsx("spx-hero-stat-value", cap && "capitalize", VALUE_TONE[tone] ?? VALUE_TONE.neutral)}>
        {value}
      </p>
    </div>
  );
}
