"use client";

import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { fmtPremium, fmtPrice } from "@/lib/api";
import { ProductMark } from "@/components/marks/ProductMark";
import { SpxLiveSpotPrice, priceVsLevel, PriceLevelIndicator } from "./SpxLiveSpotPrice";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  /** Native iOS shell — drop duplicate product title; compact hero layout. */
  nativeShell?: boolean;
};

export function SpxSniperHeader({ desk, live, nativeShell = false }: Props) {
  const hasQuote = Boolean(desk?.available && (desk?.price ?? 0) > 0);
  const showValues = Boolean(live || hasQuote);
  const spot = desk?.price ?? null;

  const topStatsRow = (
    <DeskTopStatsRow desk={desk} showValues={showValues} spot={spot} live={live} />
  );

  return (
    <header
      className={clsx(
        "spx-sniper-command border-b border-white/[0.06]",
        nativeShell ? "spx-sniper-command-native pb-2" : "pb-1.5"
      )}
    >
      <div className="spx-sniper-command-grid" aria-hidden />
      <div className="relative z-10 spx-sniper-command-band">
        {!nativeShell ? (
          <div className="spx-sniper-identity spx-sniper-identity-top shrink-0 flex items-center gap-2.5">
            <ProductMark product="spx" size={34} title="SPX Slayer" className="shrink-0" animated={false} />
            <div className="min-w-0 leading-tight">
              <h1 className="font-syne text-lg font-bold tracking-tight text-white md:text-xl">
                SPX Slayer
              </h1>
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-secondary">
                SPX · 0DTE desk
              </p>
            </div>
          </div>
        ) : null}
        <div className="spx-sniper-command-stats w-full min-w-0">{topStatsRow}</div>
        {nativeShell ? <SpxLiveSpotPrice desk={desk} live={live} size="hero" /> : null}
      </div>
    </header>
  );
}

function DeskTopStatsRow({
  desk,
  showValues,
  spot,
  live,
}: {
  desk?: SpxDeskPayload;
  showValues: boolean;
  spot: number | null;
  live?: boolean;
}) {
  return (
    <div className="spx-desk-top-stats spx-desk-top-stats--compact">
      <StatPill
        label="VIX"
        value={showValues && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"}
        tone="orange"
      />
      <StatPill
        label="VWAP"
        value={showValues ? fmtPrice(desk?.vwap ?? null) : "—"}
        tone={desk?.above_vwap ? "bull" : "bear"}
        level={desk?.vwap ?? null}
        spot={spot}
      />
      <StatPill
        label="GEX"
        value={showValues && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
        tone={(desk?.gex_net ?? 0) >= 0 ? "bull" : "bear"}
      />
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
        level={desk?.gamma_flip ?? null}
        spot={spot}
      />
      <StatPill
        label="Max Pain"
        value={showValues ? fmtPrice(desk?.max_pain ?? null) : "—"}
        tone="cyan"
        level={desk?.max_pain ?? null}
        spot={spot}
      />
      <StatPill
        label="IV Rank"
        value={showValues && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"}
        tone="gold"
      />
      <MetricBlock title="EMA" tone="orange">
        <MetricRow label="20" value={showValues ? fmtPrice(desk?.ema20 ?? null) : "—"} tone="orange" level={desk?.ema20 ?? null} spot={spot} />
        <MetricRow label="50" value={showValues ? fmtPrice(desk?.ema50 ?? null) : "—"} tone="magenta" level={desk?.ema50 ?? null} spot={spot} />
        <MetricRow label="200" value={showValues ? fmtPrice(desk?.ema200 ?? null) : "—"} tone="cyan" level={desk?.ema200 ?? null} spot={spot} />
      </MetricBlock>
      <MetricBlock title="SMA" tone="violet">
        <MetricRow label="50" value={showValues ? fmtPrice(desk?.sma50 ?? null) : "—"} tone="orange" level={desk?.sma50 ?? null} spot={spot} />
        <MetricRow label="200" value={showValues ? fmtPrice(desk?.sma200 ?? null) : "—"} tone="cyan" level={desk?.sma200 ?? null} spot={spot} />
      </MetricBlock>
      <MetricBlock title="Session" tone="bull">
        <div className="spx-hero-metric-pair">
          <MetricRow label="HOD" value={showValues ? fmtPrice(desk?.hod ?? null) : "—"} tone="resistance" compact level={desk?.hod ?? null} spot={spot} />
          <MetricRow label="PDH" value={showValues ? fmtPrice(desk?.pdh ?? null) : "—"} tone="resistance" compact level={desk?.pdh ?? null} spot={spot} />
        </div>
        <div className="spx-hero-metric-pair">
          <MetricRow label="LOD" value={showValues ? fmtPrice(desk?.lod ?? null) : "—"} tone="support" compact level={desk?.lod ?? null} spot={spot} />
          <MetricRow label="PDL" value={showValues ? fmtPrice(desk?.pdl ?? null) : "—"} tone="support" compact level={desk?.pdl ?? null} spot={spot} />
        </div>
      </MetricBlock>
      {live && desk?.gex_stale && (
        <span className="spx-hero-stat-pill border-amber-400/35 bg-amber-400/10 px-2 py-1.5 font-mono text-[9px] uppercase tracking-wider text-amber-200 self-stretch flex items-center">
          GEX stale
        </span>
      )}
    </div>
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
  spot,
  level,
}: {
  label: string;
  value: string;
  tone?: string;
  compact?: boolean;
  spot?: number | null;
  level?: number | null;
}) {
  const direction = priceVsLevel(spot, level);
  return (
    <div className={clsx("spx-hero-metric-row", compact && "spx-hero-metric-row-compact")}>
      <span className="spx-hero-metric-row-label">{label}</span>
      <span className="spx-hero-metric-row-value-wrap">
        <PriceLevelIndicator direction={direction} />
        <span className={clsx("spx-hero-metric-row-value t-num", VALUE_TONE[tone] ?? VALUE_TONE.neutral)}>
          {value}
        </span>
      </span>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone = "neutral",
  capitalize: cap,
  spot,
  level,
}: {
  label: string;
  value: string;
  tone?: string;
  capitalize?: boolean;
  spot?: number | null;
  level?: number | null;
}) {
  const direction = priceVsLevel(spot, level);
  return (
    <div className={clsx("spx-hero-stat-pill", PILL_BORDER[tone] ?? PILL_BORDER.neutral)}>
      <p className="spx-hero-stat-label">{label}</p>
      <div className="spx-hero-stat-value-row">
        {level != null && <PriceLevelIndicator direction={direction} />}
        <p
          className={clsx(
            "spx-hero-stat-value t-num",
            cap && "capitalize",
            VALUE_TONE[tone] ?? VALUE_TONE.neutral
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
