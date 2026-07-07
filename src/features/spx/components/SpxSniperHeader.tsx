"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";
import type { MarketStatusLabel } from "@/features/spx/lib/spx-market-session";
import { ProductMark } from "@/components/marks/ProductMark";
import { FreshnessChip, Kicker, type FreshnessStatus } from "@/components/ui";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  /** Native iOS shell — drop duplicate product title; compact hero layout. */
  nativeShell?: boolean;
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

export function SpxSniperHeader({ desk, live, nativeShell = false }: Props) {
  const [nativeStatsOpen, setNativeStatsOpen] = useState(false);
  const hasQuote = Boolean(desk?.available && (desk?.price ?? 0) > 0);
  /** Show grounded desk numbers whenever we have a quote — even when session is closed. */
  const showValues = Boolean(live || hasQuote);
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
    <header
      className={clsx(
        "spx-sniper-command border-b border-white/[0.06]",
        nativeShell ? "spx-sniper-command-native pb-3" : "pb-6"
      )}
    >
      {/* Ambient background layers — fully authored/animated in globals.css (grid pattern,
          scan-line sweep, pulsing glow) but were never mounted anywhere in the component
          tree until now. All three are `position: absolute` with z-0/z-[1]; per CSS stacking
          rules, positioned descendants (even at z-index 0) paint AFTER non-positioned in-flow
          content within the same stacking context — so without `relative z-10` below, these
          would render OVER the header's actual content instead of behind it. */}
      <div className="spx-sniper-command-grid" aria-hidden />
      <div className="spx-sniper-command-scan" aria-hidden />
      <div className="spx-sniper-command-glow" aria-hidden />
      <div
        className={clsx(
          "relative z-10 flex flex-col gap-4",
          !nativeShell && "xl:flex-row xl:items-start xl:justify-between xl:gap-6"
        )}
      >
        <div
          className={clsx(
            "flex min-w-0 flex-1 flex-col gap-4",
            !nativeShell && "lg:flex-row lg:items-end lg:gap-6"
          )}
        >
          {!nativeShell && (
            <div className="spx-sniper-identity shrink-0 flex items-start gap-3">
              <ProductMark product="spx" size={44} title="SPX Slayer" className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <Kicker className="mb-1.5">SPX · 0DTE desk</Kicker>
                <h1 className="font-syne text-2xl font-bold tracking-tight text-white md:text-3xl">
                  SPX Slayer
                </h1>
                <p className="spx-hero-tagline-sub mt-1 font-mono text-[11px] tracking-[0.08em] text-secondary">
                  GEX structure · dealer positioning · session levels
                </p>
              </div>
            </div>
          )}

          <div className="min-w-0 flex-1">
            {nativeShell && (
              <div className="spx-sniper-native-meta mb-2 flex flex-wrap items-center gap-2">
                <MarketStatusPill label={desk?.market_label} />
                <FreshnessChip status={freshness.status} asOf={freshness.asOf} />
                {live && desk?.gex_stale && (
                  <span className="rounded border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-200">
                    GEX stale
                  </span>
                )}
              </div>
            )}
            <AnimatePresence mode="popLayout">
              <motion.p
                key={`${desk?.price ?? 0}-${asOfRaw ?? ""}`}
                initial={{ opacity: 0.35, scale: 1.1 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className={clsx(
                  "spx-hero-price t-num text-6xl font-semibold leading-none drop-shadow-[0_0_18px_currentColor] sm:text-7xl md:text-8xl",
                  bull ? "text-bull" : "text-bear-text"
                )}
              >
                {showValues ? fmtPrice(desk?.price ?? null, 2) : "—"}
              </motion.p>
            </AnimatePresence>
            {!live && hasQuote && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-sky-300">
                Last session snapshot · not live
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 sm:mt-3">
              <span
                className={clsx(
                  "t-num text-base font-semibold md:text-lg",
                  bull ? "text-bull" : "text-bear-text"
                )}
              >
                {showValues ? fmtPct(desk?.spx_change_pct ?? null) : "—"}
              </span>
              <StatPill
                label="VIX"
                value={showValues && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"}
                tone="orange"
              />
              <StatPill
                label="VWAP"
                value={showValues ? fmtPrice(desk?.vwap ?? null) : "—"}
                tone={desk?.above_vwap ? "bull" : "bear"}
              />
              <StatPill
                label="GEX"
                value={showValues && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
                tone={(desk?.gex_net ?? 0) >= 0 ? "bull" : "bear"}
              />
            </div>
            {nativeShell ? (
              <>
                <button
                  type="button"
                  className="spx-native-stats-toggle"
                  aria-expanded={nativeStatsOpen}
                  onClick={() => setNativeStatsOpen((v) => !v)}
                >
                  {nativeStatsOpen ? "Hide desk stats" : "Show desk stats"}
                </button>
                {nativeStatsOpen ? (
                  <div className="spx-native-stats-panel">
                    <div className="spx-sniper-native-levels grid w-full grid-cols-2 gap-2">
                      <StatPill
                        label="Regime"
                        value={showValues ? (desk?.regime ?? "—") : "—"}
                        tone="violet"
                        capitalize
                      />
                      <StatPill
                        label="γ Flip"
                        value={showValues && desk?.gamma_flip ? fmtPrice(desk.gamma_flip) : "—"}
                        tone="magenta"
                      />
                      <StatPill label="Max Pain" value={showValues ? fmtPrice(desk?.max_pain ?? null) : "—"} tone="cyan" />
                      <StatPill
                        label="IV Rank"
                        value={showValues && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"}
                        tone="gold"
                      />
                    </div>
                    <div className="spx-hero-metric-blocks">
                      <MetricBlock title="EMA" tone="orange">
                        <MetricRow label="20" value={showValues ? fmtPrice(desk?.ema20 ?? null) : "—"} tone="orange" />
                        <MetricRow label="50" value={showValues ? fmtPrice(desk?.ema50 ?? null) : "—"} tone="magenta" />
                        <MetricRow label="200" value={showValues ? fmtPrice(desk?.ema200 ?? null) : "—"} tone="cyan" />
                      </MetricBlock>
                      <MetricBlock title="SMA" tone="violet">
                        <MetricRow label="50" value={showValues ? fmtPrice(desk?.sma50 ?? null) : "—"} tone="orange" />
                        <MetricRow label="200" value={showValues ? fmtPrice(desk?.sma200 ?? null) : "—"} tone="cyan" />
                      </MetricBlock>
                      <MetricBlock title="Session" tone="bull">
                        <div className="spx-hero-metric-pair">
                          <MetricRow label="HOD" value={showValues ? fmtPrice(desk?.hod ?? null) : "—"} tone="resistance" compact />
                          <MetricRow label="PDH" value={showValues ? fmtPrice(desk?.pdh ?? null) : "—"} tone="resistance" compact />
                        </div>
                        <div className="spx-hero-metric-pair">
                          <MetricRow label="LOD" value={showValues ? fmtPrice(desk?.lod ?? null) : "—"} tone="support" compact />
                          <MetricRow label="PDL" value={showValues ? fmtPrice(desk?.pdl ?? null) : "—"} tone="support" compact />
                        </div>
                      </MetricBlock>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
          <div className="spx-hero-metric-blocks">
            <MetricBlock title="EMA" tone="orange">
              <MetricRow label="20" value={showValues ? fmtPrice(desk?.ema20 ?? null) : "—"} tone="orange" />
              <MetricRow label="50" value={showValues ? fmtPrice(desk?.ema50 ?? null) : "—"} tone="magenta" />
              <MetricRow label="200" value={showValues ? fmtPrice(desk?.ema200 ?? null) : "—"} tone="cyan" />
            </MetricBlock>
            <MetricBlock title="SMA" tone="violet">
              <MetricRow label="50" value={showValues ? fmtPrice(desk?.sma50 ?? null) : "—"} tone="orange" />
              <MetricRow label="200" value={showValues ? fmtPrice(desk?.sma200 ?? null) : "—"} tone="cyan" />
            </MetricBlock>
            <MetricBlock title="Session" tone="bull">
              <div className="spx-hero-metric-pair">
                <MetricRow
                  label="HOD"
                  value={showValues ? fmtPrice(desk?.hod ?? null) : "—"}
                  tone="resistance"
                  compact
                />
                <MetricRow
                  label="PDH"
                  value={showValues ? fmtPrice(desk?.pdh ?? null) : "—"}
                  tone="resistance"
                  compact
                />
              </div>
              <div className="spx-hero-metric-pair">
                <MetricRow
                  label="LOD"
                  value={showValues ? fmtPrice(desk?.lod ?? null) : "—"}
                  tone="support"
                  compact
                />
                <MetricRow
                  label="PDL"
                  value={showValues ? fmtPrice(desk?.pdl ?? null) : "—"}
                  tone="support"
                  compact
                />
              </div>
            </MetricBlock>
          </div>
            )}
          </div>
        </div>

        {!nativeShell && (
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
              <StatPill
                label="Regime"
                value={showValues ? (desk?.regime ?? "—") : "—"}
                tone="violet"
                capitalize
              />
              <StatPill
                label="γ Flip"
                value={showValues && desk?.gamma_flip ? fmtPrice(desk.gamma_flip) : "—"}
                tone="magenta"
              />
              <StatPill label="Max Pain" value={showValues ? fmtPrice(desk?.max_pain ?? null) : "—"} tone="cyan" />
              <StatPill
                label="IV Rank"
                value={showValues && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"}
                tone="gold"
              />
            </div>
          </div>
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
      {/* Same flash-on-update recipe as the hero price (key change -> fresh initial->animate
          pop), scaled down for pill size. No `exit` prop — the old value unmounts instantly,
          the new one flashes in, matching the hero price's established pattern exactly. */}
      <AnimatePresence mode="popLayout">
        <motion.p
          key={value}
          initial={{ opacity: 0.4, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className={clsx(
            "spx-hero-stat-value t-num drop-shadow-[0_0_6px_currentColor]",
            cap && "capitalize",
            VALUE_TONE[tone] ?? VALUE_TONE.neutral
          )}
        >
          {value}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
