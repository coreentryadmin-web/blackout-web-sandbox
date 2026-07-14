"use client";

import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";
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

/** Plain-English tooltips for every ribbon metric — deterministic, no data claims. */
const METRIC_TIPS = {
  vix: "CBOE Volatility Index — the market's 30-day implied-volatility gauge. Higher = bigger expected swings.",
  vwap: "Volume-weighted average price for today's session — the fair-value line institutions track.",
  vwapVW: "True volume-weighted via SPY minute volume.",
  gex: "Net dealer gamma exposure — positive dampens moves, negative amplifies them.",
  regime: "Trend regime read from price vs the 20/50-day EMAs.",
  flip: "Strike where net dealer gamma flips sign — above it dealers dampen moves, below it they amplify.",
  maxPain: "Strike where the most option value expires worthless — a common pin magnet into the close.",
  ivRank: "Where implied volatility sits inside its 1-year range (0–100).",
  ema: "Exponential moving averages (20/50/200-day) — trend guide rails; recent price weighs more.",
  sma: "Simple moving averages (50/200-day) — slower structural trend lines.",
  session: "Session structure — today's high/low and the prior day's high/low.",
  hod: "High of day",
  lod: "Low of day",
  pdh: "Prior-day high",
  pdl: "Prior-day low",
  gexStale: "Dealer positioning feed is stale — walls/flip are last-good, not live.",
  stalled: "Index feed stalled — values shown are the last live prints, dimmed until the feed recovers.",
} as const;

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
  // Stale-honesty: a frozen tape (feed_stalled) dims every value tone — CSS-only, no
  // layout shift — so last-good numbers are never presented with live-confidence color.
  const stalled = Boolean(live && desk?.feed_stalled);
  return (
    <div
      className={clsx("spx-desk-top-stats-stack", stalled && "spx-hero-stats-stale")}
      title={stalled ? METRIC_TIPS.stalled : undefined}
    >
      {/* Single numeric strip (user spec 2026-07-13): EMA · SMA · Session blocks first,
          then the stat pills — one line at desktop, graceful two-line wrap below 1440.
          Live SPX spot LEADS the strip (user-directed 2026-07-14: moved here from the matrix
          column so the Dealer Gamma Map gets the full panel height; no snapshot caption —
          the strip's stale-dimming carries frozen-tape honesty). */}
      <div className="spx-desk-top-stats spx-desk-top-stats--compact spx-desk-top-stats--strip">
        <StripSpot desk={desk} showValues={showValues} />
        <InlineMetricGroup
          title="EMA"
          tone="orange"
          tip={METRIC_TIPS.ema}
          spot={spot}
          items={[
            { label: "20", value: showValues ? fmtPrice(desk?.ema20 ?? null) : "—", tone: "orange", level: desk?.ema20 ?? null, tip: "20-day exponential moving average" },
            { label: "50", value: showValues ? fmtPrice(desk?.ema50 ?? null) : "—", tone: "magenta", level: desk?.ema50 ?? null, tip: "50-day exponential moving average" },
            { label: "200", value: showValues ? fmtPrice(desk?.ema200 ?? null) : "—", tone: "cyan", level: desk?.ema200 ?? null, tip: "200-day exponential moving average" },
          ]}
        />
        <InlineMetricGroup
          title="SMA"
          tone="violet"
          tip={METRIC_TIPS.sma}
          spot={spot}
          items={[
            { label: "50", value: showValues ? fmtPrice(desk?.sma50 ?? null) : "—", tone: "orange", level: desk?.sma50 ?? null, tip: "50-day simple moving average" },
            { label: "200", value: showValues ? fmtPrice(desk?.sma200 ?? null) : "—", tone: "cyan", level: desk?.sma200 ?? null, tip: "200-day simple moving average" },
          ]}
        />
        <InlineMetricGroup
          title="Session"
          tone="bull"
          grid2
          tip={METRIC_TIPS.session}
          spot={spot}
          items={[
            { label: "HOD", value: showValues ? fmtPrice(desk?.hod ?? null) : "—", tone: "resistance", level: desk?.hod ?? null, tip: METRIC_TIPS.hod },
            { label: "LOD", value: showValues ? fmtPrice(desk?.lod ?? null) : "—", tone: "support", level: desk?.lod ?? null, tip: METRIC_TIPS.lod },
            { label: "PDH", value: showValues ? fmtPrice(desk?.pdh ?? null) : "—", tone: "resistance", level: desk?.pdh ?? null, tip: METRIC_TIPS.pdh },
            { label: "PDL", value: showValues ? fmtPrice(desk?.pdl ?? null) : "—", tone: "support", level: desk?.pdl ?? null, tip: METRIC_TIPS.pdl },
          ]}
        />
        <StatPill
          label="VIX"
          value={showValues && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"}
          tone="orange"
          title={METRIC_TIPS.vix}
        />
        <StatPill
          label="VWAP"
          value={showValues ? fmtPrice(desk?.vwap ?? null) : "—"}
          tone={desk?.above_vwap ? "bull" : "bear"}
          level={desk?.vwap ?? null}
          spot={spot}
          title={
            desk?.vwap_volume_weighted
              ? `${METRIC_TIPS.vwap} ${METRIC_TIPS.vwapVW}`
              : METRIC_TIPS.vwap
          }
          vw={desk?.vwap_volume_weighted === true}
        />
        <StatPill
          label="GEX"
          value={showValues && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
          tone={(desk?.gex_net ?? 0) >= 0 ? "bull" : "bear"}
          title={METRIC_TIPS.gex}
        />
        <StatPill
          label="Regime"
          value={showValues ? (desk?.regime ?? "—") : "—"}
          tone="violet"
          capitalize
          title={METRIC_TIPS.regime}
        />
        <StatPill
          label="γ Flip"
          value={showValues && desk?.gamma_flip ? fmtPrice(desk.gamma_flip) : "—"}
          tone="magenta"
          level={desk?.gamma_flip ?? null}
          spot={spot}
          title={METRIC_TIPS.flip}
        />
        <StatPill
          label="Max Pain"
          value={showValues ? fmtPrice(desk?.max_pain ?? null) : "—"}
          tone="cyan"
          level={desk?.max_pain ?? null}
          spot={spot}
          title={METRIC_TIPS.maxPain}
        />
        <StatPill
          label="IV Rank"
          value={showValues && desk?.uw_iv_rank != null ? fmtPrice(desk.uw_iv_rank, 0) : "—"}
          tone="gold"
          title={METRIC_TIPS.ivRank}
        />
        {live && desk?.gex_stale && (
          <span
            className="spx-hero-stat-pill border-amber-400/35 bg-amber-400/10 px-2 py-1.5 font-mono text-[9px] uppercase tracking-wider text-amber-200 self-stretch flex items-center"
            title={METRIC_TIPS.gexStale}
          >
            GEX stale
          </span>
        )}
      </div>
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

type InlineMetric = {
  label: string;
  value: string;
  tone: string;
  level: number | null;
  tip?: string;
};

/**
 * Pill-height metric group for the single-strip ribbon: block title on top, all values
 * inline beneath — same silhouette as StatPill so EMA/SMA/Session sit flush with the
 * stat pills on one line. Every value keeps its tone color + PriceLevelIndicator arrow.
 */
/** Live SPX spot as the strip's lead element — price + day % in the pill silhouette.
 *  Deliberately caption-free ("last session snapshot" line removed, user-directed 2026-07-14);
 *  the strip-level stale dimming already communicates a frozen tape. */
function StripSpot({ desk, showValues }: { desk?: SpxDeskPayload; showValues: boolean }) {
  const bull = (desk?.spx_change_pct ?? 0) >= 0;
  return (
    <div
      className={clsx("spx-hero-stat-pill spx-strip-spot", bull ? "border-emerald-500/40" : "border-rose-500/40")}
      title="Live SPX spot — index level and day change"
      aria-label="SPX spot price"
    >
      <p className="spx-hero-stat-label">SPX</p>
      <div className="spx-hero-stat-value-row">
        <p className={clsx("spx-strip-spot-price t-num", bull ? "text-bull" : "text-bear-text")}>
          {showValues ? fmtPrice(desk?.price ?? null, 2) : "—"}
        </p>
        <p className={clsx("spx-strip-spot-pct t-num", bull ? "text-bull" : "text-bear-text")}>
          {showValues ? fmtPct(desk?.spx_change_pct ?? null) : ""}
        </p>
      </div>
    </div>
  );
}

function InlineMetricGroup({
  title,
  tone = "bull",
  tip,
  items,
  spot,
  grid2 = false,
}: {
  title: string;
  tone?: string;
  tip?: string;
  items: InlineMetric[];
  spot: number | null;
  /** 2x2 grid layout inside the pill (Session group) — reclaims strip width so the
   *  one-line header fits at 1920 with the spot pill present (2026-07-14). */
  grid2?: boolean;
}) {
  return (
    <div
      className={clsx("spx-hero-stat-pill spx-hero-stat-pill--group", PILL_BORDER[tone] ?? PILL_BORDER.neutral)}
      title={tip}
    >
      <p className="spx-hero-stat-label">{title}</p>
      <div className={clsx("spx-hero-stat-group-row", grid2 && "spx-hero-stat-group-row--grid2")}>
        {items.map((it) => (
          <span key={it.label} className="spx-hero-stat-group-item" title={it.tip}>
            <span className="spx-hero-metric-row-label">{it.label}</span>
            <PriceLevelIndicator direction={priceVsLevel(spot, it.level)} />
            <span
              className={clsx(
                "spx-hero-metric-row-value t-num",
                VALUE_TONE[it.tone] ?? VALUE_TONE.neutral
              )}
            >
              {it.value}
            </span>
          </span>
        ))}
      </div>
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
  title,
  vw,
}: {
  label: string;
  value: string;
  tone?: string;
  capitalize?: boolean;
  spot?: number | null;
  level?: number | null;
  /** Plain-English tooltip explaining the metric (deterministic copy). */
  title?: string;
  /** True volume-weighted VWAP affordance (staging SPY-volume proxy). */
  vw?: boolean;
}) {
  const direction = priceVsLevel(spot, level);
  return (
    <div className={clsx("spx-hero-stat-pill", PILL_BORDER[tone] ?? PILL_BORDER.neutral)} title={title}>
      <p className="spx-hero-stat-label">
        {label}
        {vw && (
          <span className="spx-hero-vw-badge" title="true volume-weighted via SPY minute volume">
            VW
          </span>
        )}
      </p>
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
