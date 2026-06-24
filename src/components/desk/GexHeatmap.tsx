"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import {
  Panel,
  Badge,
  EmptyState,
  Skeleton,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
} from "@/components/ui";

/** GEX regime read derived server-side from spot vs the gamma flip. */
type GexRegime = {
  flip: number | null;
  posture: "long" | "short" | null;
  read: string;
};

/** VEX regime read derived server-side from the net dealer vanna sign. */
type VexRegime = {
  posture: "positive" | "negative" | null;
  read: string;
};

/** Net dealer dollar-gamma block. */
type GexBlock = {
  cells: Record<string, Record<string, number>>;
  strike_totals: Record<string, number>;
  call_wall: number | null;
  put_wall: number | null;
  total: number;
  flip: number | null;
  regime: GexRegime;
};

/** Net dealer dollar-vanna block. */
type VexBlock = {
  cells: Record<string, Record<string, number>>;
  strike_totals: Record<string, number>;
  pos_wall: number | null;
  neg_wall: number | null;
  total: number;
  flip: number | null;
  regime: VexRegime;
};

/** Gamma flip migration over the shift window — earlier → current. */
type FlipMigration = { from: number | null; to: number | null; delta_pts: number | null };

/** How a single wall moved over the shift window. */
type WallChange = {
  from: number | null;
  to: number | null;
  moved_pts: number | null;
  grew_pct: number | null;
};

/**
 * Intraday GEX migration (build/melt + flip drift) computed server-side and cached with the
 * matrix. `available:false` (status 'collecting') until ≥2 positioning snapshots accumulate —
 * the client never fabricates a shift. GEX-only for now; VEX migration is future work.
 */
type GexShift = {
  available: boolean;
  status?: "collecting";
  delta_by_strike?: Record<string, number>;
  flip_migration?: FlipMigration;
  wall_changes?: { call_wall: WallChange; put_wall: WallChange };
  summary?: string;
  since_ms?: number;
  baseline_ts?: number;
};

/**
 * Cross-tool overlays from the route (browser-safe shapes — NO server import).
 * Flow-per-strike is keyed by strike string; dark-pool levels are price lines.
 * Either may be null when its upstream feed is unavailable.
 */
type FlowByStrike = { call_prem: number; put_prem: number; net_prem: number };
type DarkPoolLevel = { price: number; notional: number };
type Overlays = {
  flow_by_strike: Record<string, FlowByStrike> | null;
  dark_pool_levels: DarkPoolLevel[] | null;
};

/** Restructured payload from /api/market/gex-heatmap: shared axes + gex/vex blocks. */
type GexHeatmapResponse = {
  available: boolean;
  underlying?: string;
  spot?: number;
  change_pct?: number;
  asof?: string;
  expiries?: string[];
  strikes?: number[];
  max_pain?: number | null;
  gex?: GexBlock;
  vex?: VexBlock;
  /** Intraday gamma migration (GEX-only). Present whenever a matrix is returned. */
  shift?: GexShift;
  overlays?: Overlays;
  error?: string;
};

type TickerSearchResult = { ticker: string; name: string; type?: string };

/**
 * Live spot tape from /api/market/quote — polled fast (~1.5s) so the header price
 * updates live while the gamma matrix stays on its own 20s cache. Browser-safe shape
 * (no server import): index spot is true WS (`source:'ws'`), stocks/ETFs are
 * ~1.5s shared-cached REST (`source:'rest'`). `available:false` until the first read.
 */
type QuoteResponse = {
  available: boolean;
  ticker?: string;
  price?: number;
  change_pct?: number;
  source?: "ws" | "rest";
  asof?: string;
};

async function fetchQuote(url: string): Promise<QuoteResponse> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`quote → ${res.status}`);
  return res.json();
}

/**
 * Largo desk-read narrative from /api/market/gex-heatmap/explain. The route is a
 * cache-reader (one Claude call per ticker per ~3 min) and never fabricates: when AI
 * is unconfigured or the read fails it returns { available:false, reason }.
 */
type LargoExplainResponse = {
  available: boolean;
  narrative?: string;
  asof?: string;
  ticker?: string;
  reason?: "ai-unconfigured" | "no-data" | "failed";
};

async function fetchGexHeatmap(url: string): Promise<GexHeatmapResponse> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`GEX heatmap → ${res.status}`);
  return res.json();
}

/** Compact signed dollar value: $22.1K / -$45.2M / $1.2B. */
function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs < 1) return "·";
  return `${sign}$${abs.toFixed(0)}`;
}

/** Always-signed compact dollar value: +$22.1K / -$45.2M. Used where sign is meaning. */
function fmtMoneySigned(n: number): string {
  if (n === 0) return "·";
  return n > 0 ? `+${fmtMoney(n)}` : fmtMoney(n);
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** Spot/price with fixed 2-dp precision and thousands grouping, e.g. "5,925.42". */
function fmtSpot(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compact strike label, e.g. "740" or "5,925". */
function fmtStrike(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Format an expiry (YYYY-MM-DD) as a compact column header, e.g. "Jun 27". */
function fmtExpiry(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

type Lens = "gex" | "vex";

/**
 * Per-lens color identity (brand tokens only, never grey):
 *  - GEX: positive = bull green #00e676, negative = violet #bf5fff (matches the v1 scale)
 *  - VEX: positive = sky #7dd3fc,        negative = violet #bf5fff
 */
const LENS_COLORS: Record<Lens, { posRgb: string; negRgb: string; posHex: string; negHex: string }> = {
  gex: { posRgb: "0,230,118", negRgb: "191,95,255", posHex: "#00e676", negHex: "#bf5fff" },
  vex: { posRgb: "125,211,252", negRgb: "191,95,255", posHex: "#7dd3fc", negHex: "#bf5fff" },
};

/**
 * Matrix cell background: positive ↔ negative per lens, opacity scaled by magnitude
 * relative to the matrix peak. Returns inline style so the alpha varies continuously.
 */
function cellStyle(value: number, peak: number, lens: Lens): React.CSSProperties {
  if (!value || peak <= 0) return {};
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = 0.08 + Math.pow(mag, 0.7) * 0.52;
  const c = LENS_COLORS[lens];
  const rgb = value > 0 ? c.posRgb : c.negRgb;
  return {
    backgroundColor: `rgba(${rgb},${alpha.toFixed(3)})`,
    boxShadow: mag > 0.6 ? `inset 0 0 14px rgba(${rgb},0.25)` : undefined,
  };
}

const PRESET_TICKERS = [
  "SPY", "SPX", "QQQ", "IWM", "NVDA", "TSLA", "AAPL", "AMD", "META", "AMZN", "GOOGL",
];

// ---------------------------------------------------------------------------
// Exposure profile (the hero) — vertical strike ladder of net exposure bars
// ---------------------------------------------------------------------------

type ProfileRow = {
  strike: number;
  value: number;
  isSpot: boolean;
  isFlip: boolean;
  isPosWall: boolean;
  isNegWall: boolean;
  /** HELIX net premium flow hitting this strike today, or null when no overlay data. */
  flow: FlowByStrike | null;
};

/** Dark-pool overlay colors (sky / violet) — brand tokens, never grey. */
const DARK_POOL_HEX = "#7dd3fc";
const DARK_POOL_ALT_HEX = "#bf5fff";

function ExposureProfile({
  rows,
  peak,
  spot,
  flip,
  lens,
  showFlow,
  flowPeak,
  darkPoolLevels,
  showDarkPool,
}: {
  rows: ProfileRow[];
  peak: number;
  spot: number;
  flip: number | null;
  lens: Lens;
  showFlow: boolean;
  flowPeak: number;
  darkPoolLevels: DarkPoolLevel[] | null;
  showDarkPool: boolean;
}) {
  const c = LENS_COLORS[lens];
  // Index of the divider: drawn ABOVE the first row (strikes desc) whose strike < flip.
  const flipBoundary = useMemo(() => {
    if (flip == null) return -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].strike < flip) return i;
    }
    return -1;
  }, [rows, flip]);

  // Resolve each dark-pool price level to the nearest profile-row index so the line is
  // drawn across that strike band. Only levels inside the rendered strike range appear.
  const darkPoolByRow = useMemo(() => {
    const map = new Map<number, DarkPoolLevel>();
    if (!showDarkPool || !darkPoolLevels?.length || rows.length === 0) return map;
    for (const level of darkPoolLevels) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < rows.length; i++) {
        const d = Math.abs(rows[i].strike - level.price);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      // Skip levels far outside the band (> half the strike step from any row).
      if (bestIdx >= 0 && !map.has(bestIdx)) map.set(bestIdx, level);
    }
    return map;
  }, [darkPoolLevels, rows, showDarkPool]);

  const flipLabel = lens === "gex" ? "γ flip" : "vanna flip";
  const profileLabel =
    lens === "gex"
      ? "Net dealer gamma profile by strike — positive bars right of center, negative left"
      : "Net dealer vanna profile by strike — positive bars right of center, negative left";

  return (
    <div role="img" aria-label={profileLabel} className="space-y-px">
      {rows.map((r, i) => {
        const mag = peak > 0 ? Math.min(1, Math.abs(r.value) / peak) : 0;
        const widthPct = (mag * 50).toFixed(2);
        const positive = r.value > 0;
        const barColor = positive ? c.posHex : c.negHex;
        const wall = r.isPosWall || r.isNegWall;

        // ── Flow overlay: net premium hitting this strike, colored bull/bear. ──
        const flow = showFlow ? r.flow : null;
        const netFlow = flow?.net_prem ?? 0;
        const flowMag = flow && flowPeak > 0 ? Math.min(1, Math.abs(netFlow) / flowPeak) : 0;
        const flowBull = netFlow >= 0;
        const flowHex = flowBull ? "#00e676" : "#ff2d55";
        const flowTitle =
          flow != null
            ? `Flow @ ${fmtStrike(r.strike)} · ${flowBull ? "bullish" : "bearish"} net ${fmtMoney(netFlow)} (calls ${fmtMoney(flow.call_prem)} / puts ${fmtMoney(flow.put_prem)})`
            : undefined;

        // ── Dark-pool overlay: a level line drawn across this row's band. ──
        const dpLevel = darkPoolByRow.get(i) ?? null;
        const dpHex = dpLevel && i % 2 === 0 ? DARK_POOL_HEX : DARK_POOL_ALT_HEX;

        return (
          <div key={r.strike}>
            {/* flip divider between the bracketing strikes */}
            {flip != null && i === flipBoundary && (
              <div className="flex items-center gap-2 py-1" aria-hidden>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold to-transparent shadow-[0_0_10px_#ffd23f]" />
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold">
                  {flipLabel} {fmtStrike(flip)}
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold to-transparent shadow-[0_0_10px_#ffd23f]" />
              </div>
            )}

            <div
              className={clsx(
                "group relative flex items-center gap-2 rounded-sm py-0.5 pr-1",
                r.isSpot && "outline outline-1 outline-cyan-400/70 bg-cyan-400/[0.06]"
              )}
              title={`${fmtStrike(r.strike)} · ${fmtMoney(r.value)}`}
            >
              {/* strike label (left gutter) */}
              <span
                className={clsx(
                  "w-14 shrink-0 text-right font-mono text-[11px] tabular-nums",
                  r.isSpot
                    ? "font-bold text-white"
                    : wall
                      ? "font-semibold text-gold"
                      : "text-sky-300"
                )}
              >
                <span className="inline-flex items-center justify-end gap-1">
                  {r.isSpot && <span className="text-cyan-400">●</span>}
                  {fmtStrike(r.strike)}
                </span>
              </span>

              {/* bipolar bar track with a center axis */}
              <span className="relative h-4 flex-1">
                {/* dark-pool level line — subtle horizontal rule across the band */}
                {dpLevel != null && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
                    style={{
                      backgroundColor: dpHex,
                      opacity: 0.5,
                      boxShadow: `0 0 6px ${dpHex}99`,
                    }}
                  />
                )}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/15"
                />
                <span
                  aria-hidden
                  className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[2px] motion-safe:transition-all motion-safe:duration-300"
                  style={{
                    width: `${widthPct}%`,
                    left: positive ? "50%" : undefined,
                    right: positive ? undefined : "50%",
                    backgroundColor: barColor,
                    boxShadow: wall
                      ? `0 0 10px ${barColor}`
                      : mag > 0.55
                        ? `0 0 8px ${barColor}88`
                        : undefined,
                    opacity: 0.35 + mag * 0.6,
                  }}
                />
                {/* flow marker — thin secondary bar from center, sized by net premium */}
                {flow != null && flowMag > 0 && (
                  <span
                    className="absolute top-1/2 z-10 h-[3px] -translate-y-1/2 rounded-full motion-safe:transition-all motion-safe:duration-300"
                    style={{
                      width: `${(flowMag * 46).toFixed(2)}%`,
                      left: flowBull ? "50%" : undefined,
                      right: flowBull ? undefined : "50%",
                      backgroundColor: flowHex,
                      boxShadow: `0 0 7px ${flowHex}`,
                      opacity: 0.55 + flowMag * 0.45,
                    }}
                    title={flowTitle}
                  />
                )}
                {/* flow dot anchored at the band center so even tiny flow is visible */}
                {flow != null && (netFlow !== 0 || flow.call_prem > 0 || flow.put_prem > 0) && (
                  <span
                    className="absolute top-1/2 left-1/2 z-10 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ backgroundColor: flowHex, boxShadow: `0 0 6px ${flowHex}` }}
                    title={flowTitle}
                  />
                )}
              </span>

              {/* signed value + wall tag (right gutter) */}
              <span
                className={clsx(
                  "w-24 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums",
                  positive ? (lens === "gex" ? "text-bull" : "text-sky-300") : "text-purple-light"
                )}
              >
                {fmtMoneySigned(r.value)}
              </span>
              <span className="w-10 shrink-0 text-left">
                {r.isPosWall && (
                  <span className="font-mono text-[8px] uppercase tracking-wider text-gold">
                    {lens === "gex" ? "call" : "+vex"}
                  </span>
                )}
                {r.isNegWall && (
                  <span className="font-mono text-[8px] uppercase tracking-wider text-gold">
                    {lens === "gex" ? "put" : "−vex"}
                  </span>
                )}
                {flow != null && netFlow !== 0 && !r.isPosWall && !r.isNegWall && (
                  <span
                    className="font-mono text-[8px] uppercase tracking-wider"
                    style={{ color: flowHex }}
                    title={flowTitle}
                  >
                    {fmtMoney(netFlow)}
                  </span>
                )}
              </span>
            </div>
          </div>
        );
      })}

      {/* axis legend */}
      <div className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/70">
        <span className="text-purple-light">
          ◀ {lens === "gex" ? "short γ" : "neg vanna"} (−)
        </span>
        <span
          className="text-sky-300"
          title={spot > 0 ? "Profile reflects the 20s gamma snapshot; the header price updates live." : undefined}
        >
          {spot > 0 ? `spot ${fmtStrike(spot)}` : lens === "gex" ? "net dealer gamma" : "net dealer vanna"}
        </span>
        <span className={lens === "gex" ? "text-bull" : "text-sky-300"}>
          {lens === "gex" ? "long γ" : "pos vanna"} (+) ▶
        </span>
      </div>

      {/* overlay legend — only the active overlays appear */}
      {((showFlow && flowPeak > 0) || (showDarkPool && darkPoolByRow.size > 0)) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/70">
          {showFlow && flowPeak > 0 && (
            <>
              <span className="flex items-center gap-1.5" style={{ color: "#00e676" }}>
                <span aria-hidden className="inline-block h-1 w-3 rounded-full" style={{ backgroundColor: "#00e676" }} />
                bullish flow
              </span>
              <span className="flex items-center gap-1.5" style={{ color: "#ff2d55" }}>
                <span aria-hidden className="inline-block h-1 w-3 rounded-full" style={{ backgroundColor: "#ff2d55" }} />
                bearish flow
              </span>
            </>
          )}
          {showDarkPool && darkPoolByRow.size > 0 && (
            <span className="flex items-center gap-1.5" style={{ color: DARK_POOL_HEX }}>
              <span aria-hidden className="inline-block h-px w-3" style={{ backgroundColor: DARK_POOL_HEX, boxShadow: `0 0 6px ${DARK_POOL_HEX}` }} />
              dark-pool level
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shift view — intraday gamma migration (Δ-gamma ladder: built green / melted red)
// ---------------------------------------------------------------------------

/** Human elapsed label from ms, e.g. "1h47m" / "12m". */
function fmtElapsed(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

// Build (more positive gamma) = bull green to the RIGHT; melt (more negative) = bear red to the LEFT.
const SHIFT_BUILD_HEX = "#00e676";
const SHIFT_MELT_HEX = "#ff2d55";

type ShiftRow = { strike: number; delta: number; isSpot: boolean };

function ShiftView({
  shift,
  strikes,
  spotStrike,
}: {
  shift: GexShift;
  strikes: number[];
  spotStrike: number | null;
}) {
  // Δ rows on the SHARED strike axis (descending), each strike's build/melt vs the baseline.
  const rows = useMemo<ShiftRow[]>(() => {
    const deltas = shift.delta_by_strike ?? {};
    // Union the matrix axis with any strike that changed (a strike built from 0 may sit
    // just off the current band) so migration into/out of the band is still visible.
    const axis = new Set<number>(strikes);
    for (const k of Object.keys(deltas)) {
      const n = Number(k);
      if (Number.isFinite(n)) axis.add(n);
    }
    return Array.from(axis)
      .sort((a, b) => b - a)
      .map((strike) => ({
        strike,
        delta: deltas[String(strike)] ?? 0,
        isSpot: strike === spotStrike,
      }));
  }, [shift.delta_by_strike, strikes, spotStrike]);

  const peak = useMemo(() => {
    let p = 0;
    for (const r of rows) {
      const a = Math.abs(r.delta);
      if (a > p) p = a;
    }
    return p;
  }, [rows]);

  const fm = shift.flip_migration;
  const elapsed = shift.since_ms != null ? fmtElapsed(shift.since_ms) : "—";
  const flipUp = fm?.delta_pts != null && fm.delta_pts > 0;
  const flipDown = fm?.delta_pts != null && fm.delta_pts < 0;
  const flipArrow = flipUp ? "▲" : flipDown ? "▼" : "→";
  const flipHex = flipUp ? SHIFT_BUILD_HEX : flipDown ? SHIFT_MELT_HEX : "#7dd3fc";

  return (
    <div className="space-y-3">
      {/* Summary one-liner — prominent */}
      {shift.summary && (
        <div className="rounded-xl border border-white/12 bg-[rgba(8,9,14,0.5)] px-4 py-3">
          <p className="text-[13px] leading-snug text-sky-100">{shift.summary}</p>
        </div>
      )}

      {/* Flip migration + "vs {elapsed} ago" */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 font-mono text-[11px]">
        <span className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-[0.2em] text-sky-300/60">γ flip</span>
          <span className="tabular-nums text-sky-300">
            {fm?.from != null ? fmtStrike(fm.from) : "—"}
          </span>
          <span aria-hidden style={{ color: flipHex }}>
            {flipArrow}
          </span>
          <span className="tabular-nums font-bold text-white">
            {fm?.to != null ? fmtStrike(fm.to) : "—"}
          </span>
          {fm?.delta_pts != null && fm.delta_pts !== 0 && (
            <span className="tabular-nums" style={{ color: flipHex }}>
              {fm.delta_pts > 0 ? "+" : ""}
              {fm.delta_pts} pts
            </span>
          )}
        </span>
        <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-400">
          vs {elapsed} ago
        </span>
      </div>

      {/* Δ-gamma ladder — built (right, green) vs melted (left, red) */}
      <div role="img" aria-label="Intraday Δ dealer-gamma by strike — built right (green), melted left (red)" className="space-y-px">
        {rows.map((r) => {
          const mag = peak > 0 ? Math.min(1, Math.abs(r.delta) / peak) : 0;
          const widthPct = (mag * 50).toFixed(2);
          const built = r.delta > 0;
          const barHex = built ? SHIFT_BUILD_HEX : SHIFT_MELT_HEX;
          const title = `${fmtStrike(r.strike)} · ${built ? "built" : "melted"} ${fmtMoney(r.delta)}`;
          return (
            <div
              key={r.strike}
              className={clsx(
                "group relative flex items-center gap-2 rounded-sm py-0.5 pr-1",
                r.isSpot && "outline outline-1 outline-cyan-400/70 bg-cyan-400/[0.06]"
              )}
              title={title}
            >
              <span
                className={clsx(
                  "w-14 shrink-0 text-right font-mono text-[11px] tabular-nums",
                  r.isSpot ? "font-bold text-white" : "text-sky-300"
                )}
              >
                <span className="inline-flex items-center justify-end gap-1">
                  {r.isSpot && <span className="text-cyan-400">●</span>}
                  {fmtStrike(r.strike)}
                </span>
              </span>

              <span className="relative h-4 flex-1">
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/15"
                />
                {r.delta !== 0 && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[2px] motion-safe:transition-all motion-safe:duration-300"
                    style={{
                      width: `${widthPct}%`,
                      left: built ? "50%" : undefined,
                      right: built ? undefined : "50%",
                      backgroundColor: barHex,
                      boxShadow: mag > 0.55 ? `0 0 8px ${barHex}88` : undefined,
                      opacity: 0.35 + mag * 0.6,
                    }}
                  />
                )}
              </span>

              <span
                className="w-24 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums"
                style={{ color: r.delta === 0 ? undefined : barHex }}
              >
                {r.delta !== 0 ? fmtMoneySigned(r.delta) : "·"}
              </span>
            </div>
          );
        })}
      </div>

      {/* axis legend */}
      <div className="mt-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/70">
        <span style={{ color: SHIFT_MELT_HEX }}>◀ melted (−)</span>
        <span className="text-sky-300">Δ dealer gamma</span>
        <span style={{ color: SHIFT_BUILD_HEX }}>built (+) ▶</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticker switcher — preset chips + search input wired to /api/market/ticker-search
// ---------------------------------------------------------------------------

function TickerSwitcher({
  ticker,
  onPick,
}: {
  ticker: string;
  onPick: (t: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced ticker search.
  const { data: searchData } = useSWR<{ results?: TickerSearchResult[] }>(
    query.trim().length >= 1
      ? `/api/market/ticker-search?q=${encodeURIComponent(query.trim())}&limit=8`
      : null,
    (url: string) => fetch(url, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : { results: [] })),
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );
  const results = searchData?.results ?? [];

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(t: string) {
    const sym = t.trim().toUpperCase();
    if (!sym) return;
    onPick(sym);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESET_TICKERS.map((t) => {
        const active = t === ticker;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            aria-pressed={active}
            className={clsx(
              "rounded-md px-2 py-1 font-mono text-[11px] font-semibold tracking-wide outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-sky-400",
              active
                ? "bg-cyan-400/15 text-white outline outline-1 outline-cyan-400/60"
                : "text-sky-300 hover:bg-white/[0.06] hover:text-white"
            )}
          >
            {t}
          </button>
        );
      })}

      {/* search any ticker */}
      <div ref={boxRef} className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (results[0]) pick(results[0].ticker);
              else if (query.trim()) pick(query);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search…"
          aria-label="Search any ticker"
          spellCheck={false}
          className={clsx(
            "w-28 rounded-md border border-white/12 bg-[rgba(8,9,14,0.6)] px-2 py-1 font-mono text-[11px] text-white",
            "placeholder:text-sky-300/40 outline-none focus-visible:border-sky-400/60 focus-visible:ring-1 focus-visible:ring-sky-400/50"
          )}
        />
        {open && results.length > 0 && (
          <ul
            role="listbox"
            className="absolute right-0 z-30 mt-1 max-h-60 w-60 overflow-y-auto rounded-lg border border-white/12 bg-[rgba(8,9,14,0.97)] p-1 shadow-xl backdrop-blur"
          >
            {results.map((r) => (
              <li key={r.ticker}>
                <button
                  type="button"
                  onClick={() => pick(r.ticker)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-cyan-400/10 focus-visible:bg-cyan-400/10"
                >
                  <span className="font-mono text-[12px] font-semibold text-white">{r.ticker}</span>
                  <span className="truncate text-[10px] text-sky-300/70">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Largo read — AI desk-read narrative of the current dealer positioning
// ---------------------------------------------------------------------------

/** Format an ISO timestamp as a compact ET clock label, e.g. "3:42 PM". */
function fmtAsof(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/**
 * "Ask Largo" panel. Lazy on click: the narrative is fetched only when the user opens it,
 * keyed by ticker so it clears/refetches when the ticker changes. The route itself caches
 * (one Claude call per ticker per ~3 min) so re-opens are cheap. Browser-safe: it only
 * fetches the explain route + renders JSON — no server/node imports.
 */
function LargoRead({ ticker }: { ticker: string }) {
  // `open` is keyed by ticker via the parent's `key` prop, so it resets on ticker change.
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useSWR<LargoExplainResponse>(
    open ? `/api/market/gex-heatmap/explain?ticker=${encodeURIComponent(ticker)}` : null,
    (url: string) =>
      fetch(url, { credentials: "same-origin", cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(`Largo read → ${r.status}`);
        return r.json();
      }),
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  const narrative = data?.available ? data.narrative ?? null : null;
  const unavailable = data != null && !data.available;
  const asof = fmtAsof(data?.asof);
  const failed = Boolean(error) && !isLoading;

  return (
    <div className="rounded-xl border border-sky-400/25 bg-[rgba(8,12,20,0.55)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex items-center gap-2">
          <Badge tone="sky" dot>
            Largo · AI
          </Badge>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300/70">
            Desk read
          </span>
          {open && asof && (
            <span className="font-mono text-[10px] tabular-nums text-sky-300/50">
              as of {asof} ET
            </span>
          )}
        </span>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={clsx(
            "rounded-md px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-sky-400",
            open
              ? "bg-sky-400/15 text-sky-300 outline outline-1 outline-sky-400/50"
              : "bg-sky-400/10 text-sky-300 outline outline-1 outline-sky-400/30 hover:bg-sky-400/15 hover:text-white"
          )}
        >
          {open ? "Hide read" : "Ask Largo"}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {isLoading && !data ? (
            <div className="space-y-2" aria-hidden>
              <Skeleton height={14} rounded="md" />
              <Skeleton height={14} rounded="md" />
              <Skeleton height={14} rounded="md" />
            </div>
          ) : failed || unavailable ? (
            <p className="text-[12px] leading-snug text-sky-300/70" role="status">
              {data?.reason === "ai-unconfigured"
                ? "Largo read unavailable — AI is not configured."
                : data?.reason === "no-data"
                  ? "Largo read unavailable — no dealer positioning to read for this ticker yet."
                  : "Largo read unavailable — try again in a moment."}
            </p>
          ) : narrative ? (
            <p className="text-[13px] leading-relaxed text-sky-100 whitespace-pre-line">
              {narrative}
            </p>
          ) : (
            <p className="text-[12px] leading-snug text-sky-300/70" role="status">
              Largo read unavailable — try again in a moment.
            </p>
          )}

          <p className="mt-2 text-[10px] leading-snug text-sky-300/50">
            Largo reads dealer positioning from the data above. Market-structure analysis,
            not financial advice.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regime tile — a polished, full-width stat card with accent border + glow by
// meaning (walls gold, flip cyan, net bull/bear, max-pain sky). Big tabular value.
// ---------------------------------------------------------------------------

type TileTone = "flip" | "wall" | "support" | "sky" | "bull" | "bear";

const TILE_TONE: Record<
  TileTone,
  { value: string; border: string; glow: string; rgb: string }
> = {
  flip: { value: "text-cyan-300", border: "border-cyan-400/30", glow: "#22d3ee", rgb: "34,211,238" },
  wall: { value: "text-gold", border: "border-gold/35", glow: "#ffd23f", rgb: "255,210,63" },
  support: { value: "text-bear", border: "border-bear/30", glow: "#ff2d55", rgb: "255,45,85" },
  sky: { value: "text-sky-300", border: "border-sky-400/30", glow: "#7dd3fc", rgb: "125,211,252" },
  bull: { value: "text-bull", border: "border-bull/30", glow: "#00e676", rgb: "0,230,118" },
  bear: { value: "text-bear", border: "border-bear/30", glow: "#ff2d55", rgb: "255,45,85" },
};

function RegimeTile({
  label,
  value,
  sublabel,
  tone,
  active = true,
}: {
  label: string;
  value: string;
  sublabel: string;
  tone: TileTone;
  active?: boolean;
}) {
  const t = TILE_TONE[tone];
  return (
    <div
      className={clsx(
        "relative flex flex-col justify-between overflow-hidden rounded-xl border bg-[rgba(8,9,14,0.55)] px-4 py-3 backdrop-blur",
        active ? t.border : "border-white/10"
      )}
      style={
        active
          ? { boxShadow: `inset 0 0 24px rgba(${t.rgb},0.05), 0 0 0 1px rgba(${t.rgb},0.04)` }
          : undefined
      }
    >
      {/* accent hairline strip */}
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${t.glow}, transparent)` }}
        />
      )}
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#9fb4d4]">
        {label}
      </span>
      <span
        className={clsx(
          "mt-1.5 font-anton text-3xl leading-none tabular-nums",
          active ? t.value : "text-white/40"
        )}
      >
        {value}
      </span>
      <span className="mt-1.5 text-[11px] leading-snug text-sky-300/70">{sublabel}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key levels — a compact, right-aligned list of the structural price lines
// (spot, flip, walls, max pain) + dark-pool levels. Always-useful rail content.
// ---------------------------------------------------------------------------

type KeyLevel = {
  label: string;
  value: number | null;
  tone: "cyan" | "gold" | "bull" | "bear" | "sky" | "violet";
  note?: string;
};

const LEVEL_HEX: Record<KeyLevel["tone"], string> = {
  cyan: "#22d3ee",
  gold: "#ffd23f",
  bull: "#00e676",
  bear: "#ff2d55",
  sky: "#7dd3fc",
  violet: "#bf5fff",
};

function KeyLevels({
  levels,
  darkPoolLevels,
}: {
  levels: KeyLevel[];
  darkPoolLevels: DarkPoolLevel[] | null;
}) {
  const shown = levels.filter((l) => l.value != null);
  const dp = (darkPoolLevels ?? [])
    .slice()
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 4);

  return (
    <div className="rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] px-4 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#9fb4d4]">
          Key levels
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/50">
          price
        </span>
      </div>
      <ul className="space-y-1">
        {shown.map((l) => (
          <li
            key={l.label}
            className="flex items-center justify-between gap-3 border-b border-white/[0.04] py-1 last:border-0"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: LEVEL_HEX[l.tone], boxShadow: `0 0 6px ${LEVEL_HEX[l.tone]}` }}
              />
              <span className="truncate font-mono text-[11px] uppercase tracking-wide text-sky-300">
                {l.label}
              </span>
            </span>
            <span
              className="shrink-0 font-mono text-[12px] font-bold tabular-nums"
              style={{ color: LEVEL_HEX[l.tone] }}
            >
              {l.value != null ? fmtStrike(l.value) : "—"}
            </span>
          </li>
        ))}
      </ul>

      {dp.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-2.5">
          <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/55">
            Dark-pool levels
          </span>
          <ul className="space-y-1">
            {dp.map((d, i) => (
              <li key={`${d.price}-${i}`} className="flex items-center justify-between gap-3 py-0.5">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden
                    className="h-px w-3 shrink-0"
                    style={{ backgroundColor: DARK_POOL_HEX, boxShadow: `0 0 6px ${DARK_POOL_HEX}` }}
                  />
                  <span className="font-mono text-[11px] tabular-nums text-white">
                    {fmtStrike(d.price)}
                  </span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-sky-300/80">
                  {fmtMoney(d.notional)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow summary — net premium tilt for the ticker today (bull calls / bear puts),
// derived from the per-strike HELIX overlay. Compact rail card.
// ---------------------------------------------------------------------------

function FlowSummary({ flowByStrike }: { flowByStrike: Record<string, FlowByStrike> | null }) {
  const totals = useMemo(() => {
    let call = 0;
    let put = 0;
    if (flowByStrike) {
      for (const f of Object.values(flowByStrike)) {
        call += f.call_prem;
        put += f.put_prem;
      }
    }
    return { call, put, net: call - put };
  }, [flowByStrike]);

  if (!flowByStrike || Object.keys(flowByStrike).length === 0) return null;

  const bullish = totals.net >= 0;
  const gross = Math.abs(totals.call) + Math.abs(totals.put);
  const callPct = gross > 0 ? (Math.abs(totals.call) / gross) * 100 : 50;

  return (
    <div className="rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] px-4 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#9fb4d4]">
            Flow today
          </span>
          <Badge tone="bull" size="sm">
            HELIX
          </Badge>
        </span>
        <span
          className={clsx("font-mono text-[12px] font-bold tabular-nums", bullish ? "text-bull" : "text-bear")}
        >
          {fmtMoneySigned(totals.net)}
        </span>
      </div>

      {/* call vs put premium split bar */}
      <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-[rgba(8,9,14,0.8)]">
        <span
          className="h-full"
          style={{ width: `${callPct.toFixed(1)}%`, backgroundColor: "#00e676", boxShadow: "0 0 8px #00e67688" }}
        />
        <span
          className="h-full flex-1"
          style={{ backgroundColor: "#ff2d55", boxShadow: "0 0 8px #ff2d5588" }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-bull/80">Calls</span>
          <span className="font-mono text-[13px] font-bold tabular-nums text-bull">
            {fmtMoney(totals.call)}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-bear/80">Puts</span>
          <span className="font-mono text-[13px] font-bold tabular-nums text-bear">
            {fmtMoney(totals.put)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function GexHeatmap({ ticker: initialTicker = "SPY" }: { ticker?: string }) {
  const [ticker, setTicker] = useState(initialTicker.toUpperCase());
  const [lens, setLens] = useState<Lens>("gex");
  // Cross-tool overlay toggles (default on; auto-hidden when the overlay is null).
  const [showFlow, setShowFlow] = useState(true);
  const [showDarkPool, setShowDarkPool] = useState(true);

  // Fast-move bypass: when the live quote diverges from the cached matrix snapshot spot
  // by >0.5%, we append `&force=1` to the matrix key for ONE refetch (then clear it) so
  // the gamma/vanna profile recomputes immediately instead of waiting out the 20s cache.
  // `forceNonce` busts SWR's key on each forced refresh; `fastFlash` drives a header pulse.
  const [forceNonce, setForceNonce] = useState(0);
  const [fastFlash, setFastFlash] = useState(false);
  // Last time a force was actually fired — throttles to ≤1 per 8s so a fast move can't
  // spam force-recomputes / blow the shared chain budget. Ref so it never re-renders.
  const lastForceAtRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matrixKey =
    forceNonce > 0
      ? `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}&force=1&n=${forceNonce}`
      : `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`;

  const { data, isLoading, isValidating, error } = useSWR<GexHeatmapResponse>(
    matrixKey,
    fetchGexHeatmap,
    { refreshInterval: 20_000, revalidateOnFocus: false, keepPreviousData: true }
  );

  // Live spot tape — a SEPARATE, fast (~1.5s) SWR just for the header price. Index
  // spot is true real-time WS; stocks/ETFs are ~1.5s shared-cached REST. The gamma
  // matrix keeps its own 20s cache above; only the header tape goes live.
  const { data: quote } = useSWR<QuoteResponse>(
    `/api/market/quote?ticker=${encodeURIComponent(ticker)}`,
    fetchQuote,
    { refreshInterval: 1_500, revalidateOnFocus: false, keepPreviousData: true }
  );

  const live = !error && Boolean(data?.available);
  const fetchFailed = Boolean(error) && !isLoading;

  const spot = data?.spot ?? 0;

  // ── Fast-move bypass: detect a >0.5% divergence between the LIVE quote price and the
  // cached matrix snapshot spot, and force ONE immediate matrix recompute (throttled to
  // ≤1 per 8s). This keeps the gamma/vanna profile ~20s when calm but refreshes it
  // instantly during volatile moves. The steady-state 20s refresh is untouched — force
  // is purely an ADDITIONAL trigger. Compares quote.price vs data.spot per the spec.
  const quotePrice = quote?.price ?? 0;
  useEffect(() => {
    if (!(spot > 0) || !(quotePrice > 0)) return;
    const divergence = Math.abs(quotePrice - spot) / spot;
    if (divergence <= 0.005) return;
    const nowMs = Date.now();
    if (nowMs - lastForceAtRef.current < 8_000) return; // throttle: ≤1 force / 8s
    lastForceAtRef.current = nowMs;
    setForceNonce((n) => n + 1); // appends &force=1 to the matrix key for one refetch
    // Subtle, reduced-motion-safe header flash so the forced refresh is visible.
    setFastFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFastFlash(false), 2_000);
  }, [quotePrice, spot]);

  // Once a forced refetch has resolved, drop back to the non-force key so the steady-state
  // 20s refreshInterval reads cache again — force must NEVER become the steady state. With
  // keepPreviousData, isValidating goes true while the forced (force=1) request is in
  // flight, then false once it lands; that falling edge is our cue to clear the nonce.
  const forceWasValidatingRef = useRef(false);
  useEffect(() => {
    if (forceNonce === 0) {
      forceWasValidatingRef.current = false;
      return;
    }
    if (isValidating) {
      forceWasValidatingRef.current = true; // forced request is in flight
    } else if (forceWasValidatingRef.current) {
      forceWasValidatingRef.current = false;
      setForceNonce(0); // forced refetch resolved → return to the cache-read key
    }
  }, [forceNonce, isValidating]);

  // Reset throttle + force state when the ticker changes so a switch starts clean.
  useEffect(() => {
    lastForceAtRef.current = 0;
    setForceNonce(0);
    setFastFlash(false);
  }, [ticker]);

  // Clear any pending flash timer on unmount.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);
  const expiries = useMemo(() => data?.expiries ?? [], [data?.expiries]);
  const strikes = useMemo(() => data?.strikes ?? [], [data?.strikes]);
  const maxPain = data?.max_pain ?? null;

  // ── Cross-tool overlays (server-enriched, may be null per-feed) ──────────────
  const flowByStrike = useMemo(
    () => data?.overlays?.flow_by_strike ?? null,
    [data?.overlays?.flow_by_strike]
  );
  const darkPoolLevels = useMemo(
    () => data?.overlays?.dark_pool_levels ?? null,
    [data?.overlays?.dark_pool_levels]
  );
  const hasFlowOverlay = flowByStrike != null && Object.keys(flowByStrike).length > 0;
  const hasDarkPoolOverlay = darkPoolLevels != null && darkPoolLevels.length > 0;

  // ── Intraday gamma migration (GEX-only; server-computed, cached with the matrix) ──
  const shift = data?.shift ?? null;
  // Peak |net premium| across mapped strikes — drives the flow-marker width scale.
  const flowPeak = useMemo(() => {
    if (!flowByStrike) return 0;
    let p = 0;
    for (const f of Object.values(flowByStrike)) {
      const a = Math.abs(f.net_prem);
      if (a > p) p = a;
    }
    return p;
  }, [flowByStrike]);

  // Active metric block (client-side switch — no refetch, both are in the payload).
  const block = lens === "gex" ? data?.gex : data?.vex;
  const cells = useMemo(() => block?.cells ?? {}, [block?.cells]);
  const strikeTotals = useMemo(() => block?.strike_totals ?? {}, [block?.strike_totals]);
  const flip = block?.flip ?? null;
  const total = block?.total ?? 0;

  // Per-lens walls + regime read.
  const posWall = lens === "gex" ? (data?.gex?.call_wall ?? null) : (data?.vex?.pos_wall ?? null);
  const negWall = lens === "gex" ? (data?.gex?.put_wall ?? null) : (data?.vex?.neg_wall ?? null);
  const gexPosture = data?.gex?.regime.posture ?? null;
  const vexPosture = data?.vex?.regime.posture ?? null;
  const regimeRead =
    lens === "gex"
      ? data?.gex?.regime.read ?? "Regime read unavailable."
      : data?.vex?.regime.read ?? "Regime read unavailable.";

  // The active block is empty when it has no strike totals (e.g. VEX skipped all IVs).
  const blockEmpty = Object.keys(strikeTotals).length === 0;
  const empty = !isLoading && data != null && (!data.available || strikes.length === 0);

  // Peak magnitude across the active block's cells drives the matrix color scale.
  const peak = useMemo(() => {
    let p = 0;
    for (const row of Object.values(cells)) {
      for (const v of Object.values(row)) {
        const a = Math.abs(v);
        if (a > p) p = a;
      }
    }
    return p;
  }, [cells]);

  const totalPeak = useMemo(() => {
    let p = 0;
    for (const v of Object.values(strikeTotals)) {
      const a = Math.abs(v);
      if (a > p) p = a;
    }
    return p;
  }, [strikeTotals]);

  // The strike row nearest spot — highlighted as the "spot" band.
  const spotStrike = useMemo(() => {
    if (!(spot > 0) || strikes.length === 0) return null;
    return strikes.reduce((best, s) =>
      Math.abs(s - spot) < Math.abs(best - spot) ? s : best
    );
  }, [strikes, spot]);

  // The strike row nearest the active flip — gets the flip marker (matrix view).
  const flipStrike = useMemo(() => {
    if (flip == null || strikes.length === 0) return null;
    return strikes.reduce((best, s) =>
      Math.abs(s - flip) < Math.abs(best - flip) ? s : best
    );
  }, [strikes, flip]);

  // Profile rows: strikes desc, each carrying its net value + role flags + flow overlay.
  const profileRows = useMemo<ProfileRow[]>(() => {
    return strikes.map((strike) => ({
      strike,
      value: strikeTotals[String(strike)] ?? 0,
      isSpot: strike === spotStrike,
      isFlip: strike === flipStrike,
      isPosWall: posWall != null && strike === posWall,
      isNegWall: negWall != null && strike === negWall,
      flow: flowByStrike?.[String(strike)] ?? null,
    }));
  }, [strikes, strikeTotals, spotStrike, flipStrike, posWall, negWall, flowByStrike]);

  const changePct = data?.change_pct ?? 0;
  const changeBull = changePct >= 0;
  const isGex = lens === "gex";
  const posColorClass = isGex ? "text-bull" : "text-sky-300";

  // ── Live header tape ─────────────────────────────────────────────────────────
  // Use the fast quote feed for the HEADER price/change; fall back to the matrix
  // snapshot (`data.spot` / `data.change_pct`) until the quote is available. The
  // gamma profile + matrix spot marker stay on the MATRIX `spot` (the gamma was
  // computed at that 20s snapshot) — only this header line goes live.
  const quoteLive = quote?.available && (quote.price ?? 0) > 0;
  const headerSpot = quoteLive ? (quote!.price as number) : spot;
  const headerChangePct = quoteLive ? (quote!.change_pct ?? 0) : changePct;
  const headerChangeBull = headerChangePct >= 0;
  // Bull pulse when the price is genuinely live: WS index, or a fresh REST quote.
  const quoteFresh =
    quoteLive &&
    (quote!.source === "ws" ||
      (quote!.asof != null && Date.now() - new Date(quote!.asof).getTime() < 6_000));

  return (
    <Panel
      accent={isGex ? "bull" : "sky"}
      kicker={isGex ? "Dealer gamma exposure · Polygon options" : "Dealer vanna exposure · Polygon options"}
      title={
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span>
            {data?.underlying ?? ticker} {isGex ? "GEX" : "VEX"} Positioning
          </span>
        </span>
      }
      actions={
        <span className="flex items-center gap-2">
          {/* Fast-move refresh flash — fires when a >0.5% spot divergence forces an
              immediate matrix recompute. Reduced-motion users get a static chip. */}
          {fastFlash && (
            <span
              role="status"
              className="inline-flex items-center gap-1 rounded-md bg-cyan-400/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-400 outline outline-1 outline-cyan-400/40 motion-safe:animate-pulse"
              title="Fast move detected — gamma profile refreshed immediately"
            >
              <span aria-hidden>⚡</span> fast-move refresh
            </span>
          )}
          {live ? (
            <Badge tone="bull" dot>
              Live
            </Badge>
          ) : (
            <Badge tone="neutral">Offline</Badge>
          )}
        </span>
      }
    >
      {/* ── Control bar (full width, one tight row): tickers · live tape · lens ── */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.45)] px-3 py-2.5 backdrop-blur">
        <TickerSwitcher ticker={ticker} onPick={setTicker} />

        {/* Live spot tape — centered/inline; ● pulse + price + change% */}
        {live && headerSpot > 0 && (
          <div className="flex items-center gap-2.5 font-mono">
            <span
              aria-hidden
              title={
                quoteFresh
                  ? quote?.source === "ws"
                    ? "Live spot — real-time"
                    : "Live spot — ~1.5s"
                  : "Spot — 20s snapshot"
              }
              className={clsx(
                "inline-block h-2 w-2 rounded-full",
                quoteFresh
                  ? "bg-bull shadow-[0_0_8px_#00e676] motion-safe:animate-pulse"
                  : "bg-sky-300/60"
              )}
            />
            <span className="text-[10px] uppercase tracking-[0.2em] text-sky-300/60">
              {data?.underlying ?? ticker}
            </span>
            <span className="text-lg font-bold leading-none tabular-nums text-white">
              {fmtSpot(headerSpot)}
            </span>
            <span
              className={clsx(
                "rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums",
                headerChangeBull ? "bg-bull/12 text-bull" : "bg-bear/12 text-bear"
              )}
            >
              {fmtPct(headerChangePct)}
            </span>
          </div>
        )}

        <div
          role="tablist"
          aria-label="Exposure lens"
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-[rgba(8,9,14,0.5)] p-1"
        >
          {(["gex", "vex"] as Lens[]).map((l) => {
            const active = l === lens;
            return (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setLens(l)}
                className={clsx(
                  "rounded-md px-3.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-sky-400",
                  active
                    ? l === "gex"
                      ? "bg-bull/15 text-bull outline outline-1 outline-bull/50"
                      : "bg-sky-400/15 text-sky-300 outline outline-1 outline-sky-400/50"
                    : "text-sky-300/70 hover:text-white"
                )}
              >
                {l}
              </button>
            );
          })}
        </div>
      </div>

      {fetchFailed && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-xl border border-bear/40 bg-bear/[0.08] px-4 py-3"
          style={{ boxShadow: "inset 0 0 16px rgba(255,45,85,0.06)" }}
        >
          <span className="text-bear text-sm leading-none">⚠</span>
          <span className="font-mono text-[12px] font-bold text-bear tracking-wide">
            {isGex ? "GEX" : "VEX"} feed unavailable — retrying
          </span>
        </div>
      )}

      {isLoading && !data ? (
        <div className="space-y-5" aria-hidden>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={92} rounded="xl" />
            ))}
          </div>
          <Skeleton height={44} rounded="lg" />
          <div className="grid gap-4 lg:grid-cols-[1.62fr_1fr]">
            <div className="space-y-2">
              <Skeleton height={28} rounded="lg" />
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} height={22} rounded="md" />
              ))}
            </div>
            <div className="space-y-3">
              <Skeleton height={120} rounded="xl" />
              <Skeleton height={160} rounded="xl" />
              <Skeleton height={120} rounded="xl" />
            </div>
          </div>
        </div>
      ) : empty ? (
        <EmptyState
          icon="◆"
          title="NO OPTIONS CHAIN"
          description={`No options chain for ${data?.underlying ?? ticker}. Pick a more liquid name or wait for the chain to print.`}
        />
      ) : blockEmpty ? (
        <EmptyState
          icon="◆"
          title={isGex ? "GAMMA PROFILE IDLE" : "VANNA PROFILE IDLE"}
          description={
            isGex
              ? "The options chain returned no contracts right now — the snapshot is quiet outside regular trading hours. Dealer gamma prints live during the session; try another ticker if it stays idle at the open."
              : "Vanna needs implied vol + time-to-expiry on the chain. No qualifying contracts right now — try GEX or another ticker."
          }
        />
      ) : (
        <>
          {/* ── Regime tiles (full-width row) — evenly spread polished stat cards ── */}
          {isGex ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <RegimeTile
                label="Gamma Flip"
                value={flip != null ? fmtStrike(flip) : "—"}
                sublabel="Posture pivot"
                tone="flip"
                active={flip != null}
              />
              <RegimeTile
                label="Call Wall"
                value={posWall != null ? fmtStrike(posWall) : "—"}
                sublabel="Resistance / pin"
                tone="wall"
                active={posWall != null}
              />
              <RegimeTile
                label="Put Wall"
                value={negWall != null ? fmtStrike(negWall) : "—"}
                sublabel="Support"
                tone="support"
                active={negWall != null}
              />
              <RegimeTile
                label="Max Pain"
                value={maxPain != null ? fmtStrike(maxPain) : "—"}
                sublabel="OI value floor"
                tone="sky"
                active={maxPain != null}
              />
              <RegimeTile
                label="Net GEX"
                value={fmtMoney(total)}
                sublabel="$-gamma total"
                tone={total >= 0 ? "bull" : "bear"}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <RegimeTile
                label="Vanna Flip"
                value={flip != null ? fmtStrike(flip) : "—"}
                sublabel="Sign pivot"
                tone="flip"
                active={flip != null}
              />
              <RegimeTile
                label="+Vanna Wall"
                value={posWall != null ? fmtStrike(posWall) : "—"}
                sublabel="Adds to moves"
                tone="sky"
                active={posWall != null}
              />
              <RegimeTile
                label="−Vanna Wall"
                value={negWall != null ? fmtStrike(negWall) : "—"}
                sublabel="Fades moves"
                tone="wall"
                active={negWall != null}
              />
              <RegimeTile
                label="Max Pain"
                value={maxPain != null ? fmtStrike(maxPain) : "—"}
                sublabel="OI value floor"
                tone="sky"
                active={maxPain != null}
              />
              <RegimeTile
                label="Net VEX"
                value={fmtMoney(total)}
                sublabel="$-vanna total"
                tone={total >= 0 ? "sky" : "bear"}
              />
            </div>
          )}

          {/* regime read strip — clean full-width band below the tiles */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] px-4 py-3">
            {isGex
              ? gexPosture != null && (
                  <Badge tone={gexPosture === "long" ? "bull" : "bear"} dot>
                    {gexPosture === "long" ? "Long Gamma" : "Short Gamma"}
                  </Badge>
                )
              : vexPosture != null && (
                  <Badge tone={vexPosture === "positive" ? "sky" : "accent"} dot>
                    {vexPosture === "positive" ? "Vanna Positive" : "Vanna Negative"}
                  </Badge>
                )}
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-sky-100">{regimeRead}</p>
          </div>

          {/* ── Main area — two columns at lg+ (stack below) ──────────────── */}
          <div className="mt-5 grid gap-5 lg:grid-cols-[1.62fr_1fr]">
            {/* LEFT (~62%): the profile hero with Profile | Shift | Matrix toggle */}
            <div className="min-w-0">
          {/* ── Profile | Shift | Matrix toggle ───────────────────────────
              Keyed on lens so switching GEX↔VEX resets to Profile — the Shift
              tab is GEX-only (VEX migration is future work), so it can't be
              left selected when the lens flips to VEX. */}
          <Tabs key={lens} defaultValue="profile">
            <TabList aria-label={`${isGex ? "GEX" : "VEX"} view`} className="w-fit">
              <Tab value="profile">{isGex ? "Gamma Profile" : "Vanna Profile"}</Tab>
              {isGex && <Tab value="shift">Shift</Tab>}
              <Tab value="matrix">Matrix</Tab>
            </TabList>

            <TabPanels>
              {/* Hero: exposure profile ladder */}
              <TabPanel value="profile">
                {/* Cross-tool overlay toggles — only shown when an overlay has data */}
                {(hasFlowOverlay || hasDarkPoolOverlay) && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/60">
                      Overlays
                    </span>
                    {hasFlowOverlay && (
                      <button
                        type="button"
                        onClick={() => setShowFlow((v) => !v)}
                        aria-pressed={showFlow}
                        className={clsx(
                          "rounded-md px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider outline-none transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-sky-400",
                          showFlow
                            ? "bg-bull/15 text-bull outline outline-1 outline-bull/50"
                            : "text-sky-300/70 hover:text-white"
                        )}
                      >
                        HELIX Flow
                      </button>
                    )}
                    {hasDarkPoolOverlay && (
                      <button
                        type="button"
                        onClick={() => setShowDarkPool((v) => !v)}
                        aria-pressed={showDarkPool}
                        className={clsx(
                          "rounded-md px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider outline-none transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-sky-400",
                          showDarkPool
                            ? "bg-sky-400/15 text-sky-300 outline outline-1 outline-sky-400/50"
                            : "text-sky-300/70 hover:text-white"
                        )}
                      >
                        Dark Pool
                      </button>
                    )}
                  </div>
                )}
                <ExposureProfile
                  rows={profileRows}
                  peak={totalPeak}
                  spot={spot}
                  flip={flip}
                  lens={lens}
                  showFlow={showFlow && hasFlowOverlay}
                  flowPeak={flowPeak}
                  darkPoolLevels={darkPoolLevels}
                  showDarkPool={showDarkPool && hasDarkPoolOverlay}
                />
                <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/60">
                  {isGex
                    ? "Net dealer $-gamma per strike · green long / violet short · total "
                    : "Net dealer $-vanna per strike · sky positive / violet negative · total "}
                  <span className={clsx(total >= 0 ? posColorClass : "text-purple-light")}>
                    {fmtMoney(total)}
                  </span>
                </p>
              </TabPanel>

              {/* Shift: intraday gamma migration (GEX-only) */}
              {isGex && (
                <TabPanel value="shift">
                  {shift && shift.available ? (
                    <>
                      <ShiftView shift={shift} strikes={strikes} spotStrike={spotStrike} />
                      <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/60">
                        Δ net dealer $-gamma vs earlier snapshot · green built / red melted ·
                        flip drift up = dealers longer
                      </p>
                    </>
                  ) : (
                    <EmptyState
                      icon="◷"
                      title="BUILDING POSITIONING HISTORY"
                      description="The shift view fills in as snapshots accumulate (first read ~after the open). Gamma migration — where dealer gamma is building vs melting and how the flip drifts — appears once enough history is collected."
                    />
                  )}
                </TabPanel>
              )}

              {/* Secondary detail: strike × expiry matrix */}
              <TabPanel value="matrix">
                <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-mono uppercase tracking-widest">
                  <span className="flex items-center gap-1.5 text-sky-300">
                    <span
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ backgroundColor: `rgba(${LENS_COLORS[lens].posRgb},0.5)` }}
                    />
                    {isGex ? "Long gamma (+)" : "Pos vanna (+)"}
                  </span>
                  <span className="flex items-center gap-1.5 text-sky-300">
                    <span
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ backgroundColor: `rgba(${LENS_COLORS[lens].negRgb},0.5)` }}
                    />
                    {isGex ? "Short gamma (−)" : "Neg vanna (−)"}
                  </span>
                  {flip != null && (
                    <span className="flex items-center gap-1.5 text-gold">
                      <span aria-hidden>◀ flip</span>
                      <span className="text-white">{fmtStrike(flip)}</span>
                    </span>
                  )}
                  {spot > 0 && (
                    <span className="flex items-center gap-1.5 text-cyan-400">
                      <span aria-hidden>● spot</span>
                    </span>
                  )}
                </div>

                <div
                  className="overflow-x-auto"
                  role="region"
                  aria-label={`${data?.underlying ?? ticker} dealer ${isGex ? "gamma" : "vanna"} exposure matrix, strikes by expiration`}
                >
                  <table className="w-full border-separate border-spacing-0 font-mono text-[11px]">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-[rgba(8,9,14,0.92)] px-2 py-2 text-left text-[10px] uppercase tracking-widest text-cyan-400 backdrop-blur">
                          Strike
                        </th>
                        {expiries.map((e) => (
                          <th
                            key={e}
                            className="whitespace-nowrap px-2 py-2 text-center text-[10px] uppercase tracking-wide text-sky-300"
                          >
                            {fmtExpiry(e)}
                          </th>
                        ))}
                        <th className="whitespace-nowrap px-2 py-2 text-right text-[10px] uppercase tracking-wide text-cyan-400">
                          Net
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {strikes.map((strike) => {
                        const row = cells[String(strike)] ?? {};
                        const isSpot = strike === spotStrike;
                        const isFlip = strike === flipStrike;
                        const rowTotal = strikeTotals[String(strike)] ?? 0;
                        return (
                          <tr
                            key={strike}
                            className={clsx(isSpot && "outline outline-1 outline-cyan-400/70")}
                          >
                            <th
                              scope="row"
                              className={clsx(
                                "sticky left-0 z-10 whitespace-nowrap px-2 py-1.5 text-left font-semibold tabular-nums backdrop-blur",
                                isSpot
                                  ? "bg-cyan-400/[0.12] text-white"
                                  : isFlip
                                    ? "bg-gold/[0.10] text-gold"
                                    : "bg-[rgba(8,9,14,0.92)] text-white"
                              )}
                            >
                              <span className="inline-flex items-center gap-1">
                                {isSpot && <span aria-hidden className="text-cyan-400">●</span>}
                                {isFlip && !isSpot && <span aria-hidden className="text-gold">◀</span>}
                                {fmtStrike(strike)}
                              </span>
                            </th>
                            {expiries.map((e) => {
                              const v = row[e];
                              const has = typeof v === "number";
                              return (
                                <td
                                  key={e}
                                  className={clsx(
                                    "whitespace-nowrap px-2 py-1.5 text-center tabular-nums",
                                    has
                                      ? v > 0
                                        ? posColorClass
                                        : "text-purple-light"
                                      : "text-sky-300/30"
                                  )}
                                  style={has ? cellStyle(v, peak, lens) : undefined}
                                  title={has ? `${strike} · ${fmtExpiry(e)} · ${fmtMoney(v)}` : undefined}
                                >
                                  {has ? fmtMoney(v) : "·"}
                                </td>
                              );
                            })}
                            <td
                              className={clsx(
                                "whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums",
                                rowTotal > 0 ? posColorClass : rowTotal < 0 ? "text-purple-light" : "text-sky-300/40"
                              )}
                              style={rowTotal ? cellStyle(rowTotal, totalPeak, lens) : undefined}
                            >
                              {rowTotal ? fmtMoney(rowTotal) : "·"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/60">
                  {isGex
                    ? "Net dealer $-gamma per strike × expiry · green long / violet short · total "
                    : "Net dealer $-vanna per strike × expiry · sky positive / violet negative · total "}
                  <span className={clsx(total >= 0 ? posColorClass : "text-purple-light")}>
                    {fmtMoney(total)}
                  </span>
                </p>
              </TabPanel>
            </TabPanels>
          </Tabs>
            </div>

            {/* RIGHT (~38%): Largo desk read · key levels · flow summary */}
            <aside className="min-w-0 space-y-4">
              {/* ── Largo read — AI desk-read narrative (lazy, keyed by ticker) ── */}
              <LargoRead key={ticker} ticker={ticker} />

              <KeyLevels
                levels={
                  isGex
                    ? [
                        { label: "Spot", value: spot > 0 ? spot : null, tone: "cyan" },
                        { label: "Gamma flip", value: flip, tone: "gold" },
                        { label: "Call wall", value: posWall, tone: "bull" },
                        { label: "Put wall", value: negWall, tone: "bear" },
                        { label: "Max pain", value: maxPain, tone: "sky" },
                      ]
                    : [
                        { label: "Spot", value: spot > 0 ? spot : null, tone: "cyan" },
                        { label: "Vanna flip", value: flip, tone: "gold" },
                        { label: "+Vanna wall", value: posWall, tone: "sky" },
                        { label: "−Vanna wall", value: negWall, tone: "violet" },
                        { label: "Max pain", value: maxPain, tone: "sky" },
                      ]
                }
                darkPoolLevels={darkPoolLevels}
              />

              <FlowSummary flowByStrike={flowByStrike} />
            </aside>
          </div>

          {/* ── Methodology disclosure — honest about the dealer-sign assumption ── */}
          <p className="mt-5 border-t border-white/8 pt-3 text-[10px] leading-snug text-sky-300/55">
            <span aria-hidden className="mr-1 text-sky-300/70">ⓘ</span>
            Net dealer gamma uses the standard convention (dealers long calls / short
            puts); vanna is computed closed-form from implied volatility. Levels are model
            estimates from option open interest — market-structure analysis, not advice.
          </p>
        </>
      )}
    </Panel>
  );
}
