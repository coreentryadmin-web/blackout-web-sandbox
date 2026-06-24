"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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

// ---------------------------------------------------------------------------
// Client-side per-expiry re-aggregation + wall/flip recompute (Rank 5)
// ---------------------------------------------------------------------------

/**
 * Re-sum a lens's `cells[strike][expiry]` over a chosen set of expiries entirely
 * client-side, producing filtered per-strike totals keyed by strike string. When
 * `selected` is null we fall back to the server `strike_totals` so "All" exactly
 * reproduces today's behavior (no re-sum drift); when a subset is chosen we sum the
 * matching expiry columns. Zero refetch — both `cells` and `strike_totals` ship in
 * the same payload.
 */
function filterStrikeTotals(
  cells: Record<string, Record<string, number>>,
  strikeTotals: Record<string, number>,
  selected: string[] | null
): Record<string, number> {
  if (selected == null) return strikeTotals;
  const out: Record<string, number> = {};
  for (const [strike, byExpiry] of Object.entries(cells)) {
    let sum = 0;
    for (const exp of selected) {
      const v = byExpiry[exp];
      if (typeof v === "number") sum += v;
    }
    if (sum !== 0) out[strike] = sum;
  }
  return out;
}

/**
 * Recompute walls + flip from FILTERED per-strike totals so the levels track the
 * selected expiry scope. Mirrors the server's primary method (we don't have its fn):
 *  - call/pos wall = strike of the max positive total
 *  - put/neg wall  = strike of the min (most negative) total
 *  - flip = the per-strike sign crossing (negative→positive as strike ascends) nearest
 *    spot, linearly interpolated between the bracketing strikes. Falls back to the
 *    strike of smallest |total| if no clean crossing exists.
 * Returns nulls when there's nothing to compute (so callers can defer to server levels).
 */
function recomputeLevels(
  totals: Record<string, number>,
  spot: number
): { posWall: number | null; negWall: number | null; flip: number | null } {
  const entries = Object.entries(totals)
    .map(([s, v]) => ({ strike: Number(s), value: v }))
    .filter((e) => Number.isFinite(e.strike))
    .sort((a, b) => a.strike - b.strike);
  if (entries.length === 0) return { posWall: null, negWall: null, flip: null };

  let posWall: number | null = null;
  let negWall: number | null = null;
  let posMax = -Infinity;
  let negMin = Infinity;
  for (const e of entries) {
    if (e.value > posMax) {
      posMax = e.value;
      posWall = e.strike;
    }
    if (e.value < negMin) {
      negMin = e.value;
      negWall = e.strike;
    }
  }
  if (posMax <= 0) posWall = null;
  if (negMin >= 0) negWall = null;

  // Flip: ascending sign crossing nearest spot, linearly interpolated. Among all
  // negative→positive (or positive→negative) crossings, pick the one whose interpolated
  // strike is closest to spot — that's the regime pivot a desk reads off the profile.
  let flip: number | null = null;
  let bestDist = Infinity;
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1];
    const b = entries[i];
    if (a.value === 0 || b.value === 0) continue;
    if ((a.value < 0 && b.value > 0) || (a.value > 0 && b.value < 0)) {
      const t = Math.abs(a.value) / (Math.abs(a.value) + Math.abs(b.value));
      const cross = a.strike + t * (b.strike - a.strike);
      const dist = spot > 0 ? Math.abs(cross - spot) : 0;
      if (dist < bestDist) {
        bestDist = dist;
        flip = Math.round(cross);
      }
    }
  }
  // Fallback: no clean crossing — the strike of smallest |total| is the nearest pivot.
  if (flip == null) {
    let best = Infinity;
    for (const e of entries) {
      const a = Math.abs(e.value);
      if (a < best) {
        best = a;
        flip = e.strike;
      }
    }
  }
  return { posWall, negWall, flip };
}

// ---------------------------------------------------------------------------
// Accessible info affordance (Rank 8) — a focusable "ⓘ" trigger that reveals a
// short plain-language explainer. No UI Tooltip/Popover primitive exists, so this
// is a self-contained accessible implementation: the trigger is a real <button>,
// labeled, with aria-describedby pointing at the bubble; hover OR focus opens it,
// blur/mouseleave AND Escape close it. Brand colors only, reduced-motion safe.
// ---------------------------------------------------------------------------

function InfoTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`${label} — what this means`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={clsx(
          "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[8px] font-bold leading-none outline-none transition-colors",
          "border-sky-400/40 text-sky-300 hover:border-sky-400/80 hover:text-white",
          "focus-visible:ring-2 focus-visible:ring-sky-400"
        )}
      >
        <span aria-hidden>i</span>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={clsx(
            "absolute left-1/2 top-full z-40 mt-1.5 w-56 -translate-x-1/2 rounded-lg border border-sky-400/30 px-3 py-2",
            "bg-[rgba(6,9,16,0.97)] text-[11px] leading-snug text-sky-100 shadow-xl backdrop-blur",
            "motion-safe:transition-opacity"
          )}
        >
          <span className="mb-0.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/80">
            {label}
          </span>
          {text}
        </span>
      )}
    </span>
  );
}

/** Plain-language per-metric explainers — the SpotGamma "legibility" layer (Rank 8). */
const METRIC_HELP = {
  gammaFlip:
    "The pivot strike where net dealer gamma flips sign. Above it dealers are long gamma (they dampen moves → range-bound); below it they're short gamma (they amplify moves → vol expansion).",
  callWall:
    "The strike with the most positive dealer gamma — an upside magnet that often acts as resistance / a pin as spot approaches.",
  putWall:
    "The strike with the most negative dealer gamma — typically downside support where dealer hedging slows declines.",
  maxPain:
    "The strike where the most option open interest expires worthless — an OI-gravity level price tends to drift toward into expiration.",
  netGex:
    "Total net dealer dollar-gamma. Positive = net long gamma (dealers fade moves, suppressing vol); negative = net short gamma (dealers chase moves, feeding vol).",
  vannaFlip:
    "The strike where net dealer vanna flips sign — the pivot for how dealer hedging reacts to changes in implied volatility.",
  posVannaWall: "The strike with the most positive dealer vanna — where vol-driven hedging adds to directional moves.",
  negVannaWall: "The strike with the most negative dealer vanna — where vol-driven hedging fades directional moves.",
  netVex: "Total net dealer dollar-vanna — the aggregate sensitivity of dealer hedging to shifts in implied volatility.",
  spot: "The current underlying price — where the tape sits relative to the structural levels below.",
} as const;

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
        // Fill the FULL available track on each side: each half is 50% of the bar
        // track, so a peak bar (mag→1) reaches the edge. A gentle gamma curve lets
        // mid-magnitude bars fill more of their side (so the profile doesn't read
        // as half-empty on wide monitors); a small floor keeps tiny bars visible.
        const widthPct = (r.value !== 0 ? Math.max(3, Math.pow(mag, 0.82) * 50) : 0).toFixed(2);
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
              <span className="relative h-5 flex-1">
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
                  className="absolute top-1/2 h-4 -translate-y-1/2 rounded-[3px] motion-safe:transition-all motion-safe:duration-300"
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
                    className="absolute top-1/2 z-10 h-1 -translate-y-1/2 rounded-full motion-safe:transition-all motion-safe:duration-300"
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
// Cumulative exposure curve (Rank 12) — the canonical pro visual: the running
// sum of per-strike net exposure across strikes ascending, drawn as an area/line.
// The zero-crossing is the gamma (or vanna) flip; below it = short-gamma (bear),
// above it = long-gamma (bull). Spot is marked. Respects the rank-5 expiry filter
// (it's fed the FILTERED rows). Hand-rolled inline SVG to match the bar aesthetic
// and stay fully client-side / SSR-safe — no recharts ResponsiveContainer sizing.
// ---------------------------------------------------------------------------

function CumulativeCurve({
  rows,
  spot,
  flip,
  lens,
}: {
  /** Profile rows (strikes DESCENDING, as the profile renders). */
  rows: ProfileRow[];
  spot: number;
  flip: number | null;
  lens: Lens;
}) {
  const c = LENS_COLORS[lens];
  // Re-order ascending for the cumulative running sum, then build the curve points.
  const curve = useMemo(() => {
    const asc = rows.map((r) => ({ strike: r.strike, value: r.value })).sort((a, b) => a.strike - b.strike);
    let run = 0;
    const pts = asc.map((p) => {
      run += p.value;
      return { strike: p.strike, cum: run };
    });
    return pts;
  }, [rows]);

  const W = 560;
  const H = 200;
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 18;

  const geom = useMemo(() => {
    if (curve.length < 2) return null;
    const strikeMin = curve[0].strike;
    const strikeMax = curve[curve.length - 1].strike;
    const span = strikeMax - strikeMin || 1;
    let cumMax = 0;
    for (const p of curve) {
      const a = Math.abs(p.cum);
      if (a > cumMax) cumMax = a;
    }
    if (cumMax <= 0) cumMax = 1;

    const x = (strike: number) => padL + ((strike - strikeMin) / span) * (W - padL - padR);
    // y: +cum at top, −cum at bottom, zero line through the vertical middle.
    const zeroY = padT + (H - padT - padB) / 2;
    const y = (cum: number) => zeroY - (cum / cumMax) * ((H - padT - padB) / 2);

    const pathPts = curve.map((p) => `${x(p.strike).toFixed(1)},${y(p.cum).toFixed(1)}`);
    const linePath = `M${pathPts.join("L")}`;
    // Area down to the zero line — split bull (cum≥0) vs bear (cum<0) by clipping.
    const areaPath = `${linePath}L${x(strikeMax).toFixed(1)},${zeroY.toFixed(1)}L${x(strikeMin).toFixed(1)},${zeroY.toFixed(1)}Z`;

    // Zero-crossing of the CUMULATIVE curve = the flip. Interpolate the nearest crossing.
    let crossStrike: number | null = null;
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1];
      const b = curve[i];
      if ((a.cum < 0 && b.cum >= 0) || (a.cum > 0 && b.cum <= 0)) {
        const t = Math.abs(a.cum) / (Math.abs(a.cum) + Math.abs(b.cum) || 1);
        crossStrike = a.strike + t * (b.strike - a.strike);
        break;
      }
    }
    const flipX = flip != null && flip >= strikeMin && flip <= strikeMax ? x(flip) : crossStrike != null ? x(crossStrike) : null;
    const spotX = spot > 0 && spot >= strikeMin && spot <= strikeMax ? x(spot) : null;

    return { x, y, zeroY, linePath, areaPath, flipX, spotX, strikeMin, strikeMax, cumMax };
  }, [curve, flip, spot]);

  if (!geom) {
    return (
      <p className="py-6 text-center font-mono text-[11px] uppercase tracking-widest text-sky-300/60">
        Not enough strikes to plot the cumulative curve.
      </p>
    );
  }

  const label =
    lens === "gex"
      ? "Cumulative net dealer gamma across strikes — zero-crossing is the gamma flip; short-gamma below, long-gamma above"
      : "Cumulative net dealer vanna across strikes — zero-crossing is the vanna flip; negative below, positive above";
  const gradId = `cum-grad-${lens}`;
  const clipBullId = `cum-clip-bull-${lens}`;
  const clipBearId = `cum-clip-bear-${lens}`;

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
      >
        <defs>
          {/* Clip the area into the long-gamma (above zero) and short-gamma (below) halves. */}
          <clipPath id={clipBullId}>
            <rect x="0" y={padT} width={W} height={geom.zeroY - padT} />
          </clipPath>
          <clipPath id={clipBearId}>
            <rect x="0" y={geom.zeroY} width={W} height={H - padB - geom.zeroY} />
          </clipPath>
        </defs>

        {/* zero line (the flip axis) */}
        <line
          x1={padL}
          y1={geom.zeroY}
          x2={W - padR}
          y2={geom.zeroY}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={1}
        />

        {/* long-gamma fill (above zero) — bull/sky identity */}
        <path d={geom.areaPath} fill={c.posHex} fillOpacity={0.16} clipPath={`url(#${clipBullId})`} />
        {/* short-gamma fill (below zero) — violet/bear identity */}
        <path d={geom.areaPath} fill={c.negHex} fillOpacity={0.16} clipPath={`url(#${clipBearId})`} />

        {/* the cumulative line itself */}
        <path
          d={geom.linePath}
          fill="none"
          stroke="#ffd23f"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 3px rgba(255,210,63,0.5))" }}
        />

        {/* flip marker — vertical gold line at the zero-crossing */}
        {geom.flipX != null && (
          <line
            x1={geom.flipX}
            y1={padT}
            x2={geom.flipX}
            y2={H - padB}
            stroke="#ffd23f"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.8}
          />
        )}

        {/* spot marker — vertical cyan line */}
        {geom.spotX != null && (
          <line
            x1={geom.spotX}
            y1={padT}
            x2={geom.spotX}
            y2={H - padB}
            stroke="#22d3ee"
            strokeWidth={1}
            opacity={0.85}
          />
        )}
      </svg>

      {/* x-axis strike endpoints + legend */}
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/70">
        <span className="tabular-nums">{fmtStrike(geom.strikeMin)}</span>
        <span className="flex items-center gap-3">
          {geom.flipX != null && (
            <span className="flex items-center gap-1 text-gold">
              <span aria-hidden className="inline-block h-2.5 w-px" style={{ backgroundColor: "#ffd23f" }} />
              {lens === "gex" ? "γ flip" : "vanna flip"}
            </span>
          )}
          {geom.spotX != null && (
            <span className="flex items-center gap-1 text-cyan-400">
              <span aria-hidden className="inline-block h-2.5 w-px" style={{ backgroundColor: "#22d3ee" }} />
              spot
            </span>
          )}
        </span>
        <span className="tabular-nums">{fmtStrike(geom.strikeMax)}</span>
      </div>

      {/* identity legend — short vs long gamma halves */}
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/70">
        <span style={{ color: c.negHex }}>
          {lens === "gex" ? "short γ" : "neg vanna"} (below flip)
        </span>
        <span style={{ color: c.posHex }}>
          {lens === "gex" ? "long γ" : "pos vanna"} (above flip)
        </span>
      </div>
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
          // Match the profile: fill the full per-side track with a gentle gamma curve.
          const widthPct = (r.delta !== 0 ? Math.max(3, Math.pow(mag, 0.82) * 50) : 0).toFixed(2);
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

              <span className="relative h-5 flex-1">
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/15"
                />
                {r.delta !== 0 && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 h-4 -translate-y-1/2 rounded-[3px] motion-safe:transition-all motion-safe:duration-300"
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
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounce the query feeding the SWR key (~250ms) so typing "GOOGL" mints ONE
  // fetch instead of five. The input stays fully responsive (`query`); only the
  // network key (`debouncedQuery`) trails behind.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Debounced ticker search — also requires length >= 2 to fire (single-char
  // queries are too broad to be useful and would fan out one fetch per keystroke).
  const { data: searchData } = useSWR<{ results?: TickerSearchResult[] }>(
    debouncedQuery.length >= 2
      ? `/api/market/ticker-search?q=${encodeURIComponent(debouncedQuery)}&limit=8`
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
    setDebouncedQuery("");
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
            <span className="font-mono text-[10px] tabular-nums text-sky-300/75">
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

          <p className="mt-2 text-[10px] leading-snug text-sky-300/75">
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
  className,
  help,
}: {
  label: string;
  value: string;
  sublabel: string;
  tone: TileTone;
  active?: boolean;
  /** Grid-placement utilities applied to the tile root (e.g. col-span overrides). */
  className?: string;
  /** Plain-language explainer surfaced via an accessible info affordance (Rank 8). */
  help?: string;
}) {
  const t = TILE_TONE[tone];
  return (
    <div
      className={clsx(
        "relative flex flex-col justify-between overflow-hidden rounded-xl border bg-[rgba(8,9,14,0.55)] px-4 py-3 backdrop-blur",
        active ? t.border : "border-white/10",
        className
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
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
        {label}
        {help && <InfoTip label={label} text={help} />}
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
  /** Plain-language explainer surfaced via an accessible info affordance (Rank 8). */
  help?: string;
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
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
          Key levels
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/75">
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
              {l.help && <InfoTip label={l.label} text={l.help} />}
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
          <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/75">
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
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
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

// ---------------------------------------------------------------------------
// Expiry scope chips (Rank 5) — All · 0DTE · one per expiry. Drives the profile
// AND the cumulative curve client-side (re-sum over the chosen expiries). Shared
// between both panels so the scope is consistent and obvious.
// ---------------------------------------------------------------------------

function ExpiryScopeBar({
  expiries,
  zeroDteExpiry,
  scope,
  onScope,
}: {
  expiries: string[];
  zeroDteExpiry: string | null;
  scope: string;
  onScope: (s: string) => void;
}) {
  if (expiries.length === 0) return null;
  // 0DTE is redundant when there's a single expiry (it IS the only one) — hide it then.
  const showZeroDte = zeroDteExpiry != null && expiries.length > 1;

  const chip = (value: string, label: string, title: string) => {
    const active = scope === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => onScope(value)}
        aria-pressed={active}
        title={title}
        className={clsx(
          "rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-sky-400",
          active
            ? "bg-cyan-400/15 text-white outline outline-1 outline-cyan-400/60"
            : "text-sky-300/70 hover:bg-white/[0.06] hover:text-white"
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/60">
        Expiry
      </span>
      {chip("all", "All", "All expiries — the full-stack positioning")}
      {showZeroDte &&
        chip(
          "0dte",
          "0DTE",
          `Nearest expiry${zeroDteExpiry ? ` (${fmtExpiry(zeroDteExpiry)})` : ""} — today's positioning`
        )}
      {expiries.map((e) => chip(e, fmtExpiry(e), `${fmtExpiry(e)} positioning only`))}
    </div>
  );
}

export function GexHeatmap({ ticker: initialTicker = "SPY" }: { ticker?: string }) {
  const [ticker, setTicker] = useState(initialTicker.toUpperCase());
  const [lens, setLens] = useState<Lens>("gex");
  // Cross-tool overlay toggles (default on; auto-hidden when the overlay is null).
  const [showFlow, setShowFlow] = useState(true);
  const [showDarkPool, setShowDarkPool] = useState(true);
  // Expiry scope for the profile + curve (Rank 5). "all" = today's behavior (server
  // strike_totals); "0dte" = the nearest/earliest expiry; otherwise a specific expiry
  // string. The subset re-sums cells[strike] over the chosen expiry/expiries entirely
  // client-side (no refetch) and re-derives walls/flip from those filtered totals.
  const [expiryScope, setExpiryScope] = useState<string>("all");

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
  // Fallback timer that guarantees forceNonce returns to 0 even if SWR resolves the
  // forced revalidation instantly (cache/dedupe/batch) and the settle effect is missed.
  const forceResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matrixKey =
    forceNonce > 0
      ? `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}&force=1&n=${forceNonce}`
      : `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`;

  // When the force key resolves (success OR error), clear the nonce so the next
  // refresh reads cache again — force must NEVER become the steady state (Rank 19).
  // These callbacks fire EXACTLY when the forced request settles (never prematurely,
  // always eventually), so they're the primary, race-free reset path. The armed
  // fallback timeout in the fast-move effect is the backstop for any missed callback.
  const clearForceNonce = () => {
    setForceNonce((n) => (n > 0 ? 0 : n));
  };
  const { data, isLoading, error } = useSWR<GexHeatmapResponse>(
    matrixKey,
    fetchGexHeatmap,
    {
      refreshInterval: 20_000,
      revalidateOnFocus: false,
      keepPreviousData: true,
      onSuccess: clearForceNonce,
      onError: clearForceNonce,
    }
  );

  // Live spot tape — a SEPARATE, fast (~1.5s) SWR just for the header price. Index
  // spot is true real-time WS; stocks/ETFs are ~1.5s shared-cached REST. The gamma
  // matrix keeps its own 20s cache above; only the header tape goes live.
  const { data: quote } = useSWR<QuoteResponse>(
    `/api/market/quote?ticker=${encodeURIComponent(ticker)}`,
    fetchQuote,
    { refreshInterval: 1_500, revalidateOnFocus: false, keepPreviousData: true }
  );

  // ── Stale cross-ticker gate (Rank 10) ───────────────────────────────────────
  // Both SWRs use keepPreviousData, so on a ticker switch the PREVIOUS ticker's
  // payload renders under the NEW title for ~one round-trip. `stale` is true while
  // the in-hand matrix belongs to a different underlying than the selected ticker;
  // we show the skeleton in that window and gate the fast-move effect on it so the
  // new quote isn't compared against the old ticker's spot (a spurious divergence).
  const stale =
    data != null && (data.underlying ?? "").toUpperCase() !== ticker.toUpperCase();
  // Header tape is guarded the same way: only trust the quote when it's for the
  // selected ticker (it also uses keepPreviousData across switches).
  const quoteMatches =
    quote != null && (quote.ticker ?? "").toUpperCase() === ticker.toUpperCase();

  // Matrix content presence — drives the "Live" vs "Quote only" badge (Rank 14).
  const hasStrikes = (data?.strikes?.length ?? 0) > 0;
  // Green "Live" only when a fresh, current-ticker chain actually has strikes.
  const live = !error && Boolean(data?.available) && hasStrikes && !stale;
  // A spot resolved but the chain is empty (e.g. emptyHeatmap sets available:true
  // with a spot and no strikes) → a quieter "Quote only" state, not a pulsing Live.
  const quoteOnly = !error && Boolean(data?.available) && !hasStrikes && !stale;
  const fetchFailed = Boolean(error) && !isLoading;

  const spot = data?.spot ?? 0;

  // ── Fast-move bypass: detect a >0.5% divergence between the LIVE quote price and the
  // cached matrix snapshot spot, and force ONE immediate matrix recompute (throttled to
  // ≤1 per 8s). This keeps the gamma/vanna profile ~20s when calm but refreshes it
  // instantly during volatile moves. The steady-state 20s refresh is untouched — force
  // is purely an ADDITIONAL trigger. Compares quote.price vs data.spot per the spec.
  const quotePrice = quote?.price ?? 0;
  useEffect(() => {
    // Guard: only compare when BOTH feeds are for the currently-selected ticker.
    // On a ticker switch keepPreviousData leaves the old matrix/quote in hand for a
    // round-trip; comparing the new quote vs the old spot would manufacture a huge
    // false divergence and spuriously fire force=1. (Rank 10)
    if (stale || !quoteMatches) return;
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
    // Arm a fallback that ZEROES the nonce a few seconds out, no matter what SWR
    // does — guarantees force can never become steady state even if the SWR
    // onSuccess/onError reset is somehow missed. The forced request still fires
    // first (4s ≫ a round-trip), so the bypass is never short-circuited. (Rank 19)
    if (forceResetTimerRef.current) clearTimeout(forceResetTimerRef.current);
    forceResetTimerRef.current = setTimeout(() => setForceNonce(0), 4_000);
  }, [quotePrice, spot, stale, quoteMatches]);

  // Reset throttle + force state when the ticker changes so a switch starts clean.
  // Also reset the expiry scope back to "All" — the expiry axis differs per chain, so a
  // per-expiry chip from the previous ticker would be stale against the new one (Rank 5).
  useEffect(() => {
    lastForceAtRef.current = 0;
    setForceNonce(0);
    setFastFlash(false);
    setExpiryScope("all");
  }, [ticker]);

  // Clear any pending timers on unmount.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (forceResetTimerRef.current) clearTimeout(forceResetTimerRef.current);
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

  // ── Per-expiry / 0DTE scope (Rank 5) ─────────────────────────────────────────
  // "0dte" resolves to today's date if it's on the axis, else the earliest expiry.
  const zeroDteExpiry = useMemo<string | null>(() => {
    if (expiries.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    return expiries.includes(today) ? today : expiries[0];
  }, [expiries]);

  // The expiries the profile + curve sum over. null ⇒ "All" (use server totals).
  const selectedExpiries = useMemo<string[] | null>(() => {
    if (expiryScope === "all") return null;
    if (expiryScope === "0dte") return zeroDteExpiry ? [zeroDteExpiry] : null;
    return [expiryScope];
  }, [expiryScope, zeroDteExpiry]);

  // Filtered per-strike totals (re-summed from cells when a subset is active; the server
  // strike_totals verbatim for "All" so it exactly matches today's behavior). These drive
  // the profile bars AND the cumulative curve. Zero refetch — both are in the payload.
  const filteredTotals = useMemo(
    () => filterStrikeTotals(cells, strikeTotals, selectedExpiries),
    [cells, strikeTotals, selectedExpiries]
  );

  // Walls + flip recomputed from the FILTERED totals so the profile levels track the
  // selected scope. For "All" we keep the server-computed levels (authoritative); for a
  // subset we mirror the server's primary method client-side.
  const filteredLevels = useMemo(() => {
    if (selectedExpiries == null) return { posWall, negWall, flip };
    return recomputeLevels(filteredTotals, spot);
  }, [selectedExpiries, filteredTotals, spot, posWall, negWall, flip]);
  const profilePosWall = filteredLevels.posWall;
  const profileNegWall = filteredLevels.negWall;
  const profileFlip = filteredLevels.flip;

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

  // Peak of the FILTERED totals — scales the profile bars under the active expiry scope
  // so a 0DTE-only view doesn't render as a few faint bars against the all-expiry peak.
  const filteredPeak = useMemo(() => {
    let p = 0;
    for (const v of Object.values(filteredTotals)) {
      const a = Math.abs(v);
      if (a > p) p = a;
    }
    return p;
  }, [filteredTotals]);

  // Net total under the active scope — the filtered sum drives the profile/curve footer.
  const filteredTotal = useMemo(() => {
    if (selectedExpiries == null) return total;
    let s = 0;
    for (const v of Object.values(filteredTotals)) s += v;
    return s;
  }, [selectedExpiries, filteredTotals, total]);

  // Human label for the active scope, used in the profile/curve footers.
  const scopeLabel = useMemo(() => {
    if (expiryScope === "all") return "all-expiry";
    if (expiryScope === "0dte") return zeroDteExpiry ? `${fmtExpiry(zeroDteExpiry)} (0DTE)` : "0DTE";
    return fmtExpiry(expiryScope);
  }, [expiryScope, zeroDteExpiry]);

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

  // Profile rows: strikes desc, each carrying its FILTERED net value + role flags + flow
  // overlay. Values + wall flags follow the rank-5 expiry scope so the profile and the
  // cumulative curve (which is fed these same rows) track the selected expiry/expiries.
  const profileRows = useMemo<ProfileRow[]>(() => {
    return strikes.map((strike) => ({
      strike,
      value: filteredTotals[String(strike)] ?? 0,
      isSpot: strike === spotStrike,
      isFlip: profileFlip != null && strike === profileFlip,
      isPosWall: profilePosWall != null && strike === profilePosWall,
      isNegWall: profileNegWall != null && strike === profileNegWall,
      flow: flowByStrike?.[String(strike)] ?? null,
    }));
  }, [strikes, filteredTotals, spotStrike, profileFlip, profilePosWall, profileNegWall, flowByStrike]);

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
            {/* While stale (old ticker's payload still in hand), show the SELECTED
                ticker so the title never reads the previous underlying. (Rank 10) */}
            {stale ? ticker : data?.underlying ?? ticker} {isGex ? "GEX" : "VEX"} Positioning
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
          {/* Live (green pulse) only when a fresh, current-ticker chain has strikes.
              A spot-only snapshot (chain empty) shows a quieter "Quote only" pill
              instead of a pulsing green Live over a "NO OPTIONS CHAIN" body. (Rank 14) */}
          {live ? (
            <Badge tone="bull" dot>
              Live
            </Badge>
          ) : quoteOnly ? (
            <Badge tone="sky">Quote only</Badge>
          ) : (
            <Badge tone="neutral">Offline</Badge>
          )}
        </span>
      }
    >
      {/* ── Control bar (full width, one tight row): tickers · live tape · lens ── */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.45)] px-3 py-2.5 backdrop-blur">
        <TickerSwitcher ticker={ticker} onPick={setTicker} />

        {/* Live spot tape — centered/inline; ● pulse + price + change%.
            Wrapped in an aria-live polite region so screen readers announce
            price/change updates, with a visually-hidden label for context.
            Shows whenever a current-ticker spot resolved (live OR quote-only). */}
        {(live || quoteOnly) && headerSpot > 0 && (
          <div
            className="flex items-center gap-2.5 font-mono"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="sr-only">
              Live price for {data?.underlying ?? ticker}: {fmtSpot(headerSpot)},{" "}
              {headerChangeBull ? "up" : "down"} {fmtPct(headerChangePct)}
            </span>
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
            <span aria-hidden className="text-[10px] uppercase tracking-[0.2em] text-sky-300/75">
              {data?.underlying ?? ticker}
            </span>
            <span aria-hidden className="text-lg font-bold leading-none tabular-nums text-white">
              {fmtSpot(headerSpot)}
            </span>
            <span
              aria-hidden
              className={clsx(
                "rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums",
                headerChangeBull ? "bg-bull/12 text-bull" : "bg-bear/12 text-bear"
              )}
            >
              {fmtPct(headerChangePct)}
            </span>
          </div>
        )}

        {/* Lens switcher — on the shared Tabs primitive (controlled by `lens`) for
            consistent ARIA wiring + keyboard nav (Arrow/Home/End, roving tabindex).
            `unstyled` keeps the per-lens bull/sky color identity. */}
        <Tabs value={lens} onValueChange={(v) => setLens(v as Lens)}>
          <TabList
            aria-label="Exposure lens"
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-[rgba(8,9,14,0.5)] p-1"
          >
            {(["gex", "vex"] as Lens[]).map((l) => {
              const active = l === lens;
              return (
                <Tab
                  key={l}
                  value={l}
                  unstyled
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
                </Tab>
              );
            })}
          </TabList>
        </Tabs>
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

      {/* Skeleton on first load AND while stale — during a ticker switch the previous
          ticker's payload is still in hand (keepPreviousData); showing the skeleton
          stops the old matrix rendering under the new title. (Rank 10) */}
      {(isLoading && !data) || stale ? (
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
                help={METRIC_HELP.gammaFlip}
              />
              <RegimeTile
                label="Call Wall"
                value={posWall != null ? fmtStrike(posWall) : "—"}
                sublabel="Resistance / pin"
                tone="wall"
                active={posWall != null}
                help={METRIC_HELP.callWall}
              />
              <RegimeTile
                label="Put Wall"
                value={negWall != null ? fmtStrike(negWall) : "—"}
                sublabel="Support"
                tone="support"
                active={negWall != null}
                help={METRIC_HELP.putWall}
              />
              <RegimeTile
                label="Max Pain"
                value={maxPain != null ? fmtStrike(maxPain) : "—"}
                sublabel="OI value floor"
                tone="sky"
                active={maxPain != null}
                help={METRIC_HELP.maxPain}
              />
              <RegimeTile
                label="Net GEX"
                value={fmtMoneySigned(total)}
                sublabel="$-gamma total"
                tone={total >= 0 ? "bull" : "bear"}
                className="col-span-2 lg:col-span-1"
                help={METRIC_HELP.netGex}
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
                help={METRIC_HELP.vannaFlip}
              />
              <RegimeTile
                label="+Vanna Wall"
                value={posWall != null ? fmtStrike(posWall) : "—"}
                sublabel="Adds to moves"
                tone="sky"
                active={posWall != null}
                help={METRIC_HELP.posVannaWall}
              />
              <RegimeTile
                label="−Vanna Wall"
                value={negWall != null ? fmtStrike(negWall) : "—"}
                sublabel="Fades moves"
                tone="wall"
                active={negWall != null}
                help={METRIC_HELP.negVannaWall}
              />
              <RegimeTile
                label="Max Pain"
                value={maxPain != null ? fmtStrike(maxPain) : "—"}
                sublabel="OI value floor"
                tone="sky"
                active={maxPain != null}
                help={METRIC_HELP.maxPain}
              />
              <RegimeTile
                label="Net VEX"
                value={fmtMoneySigned(total)}
                sublabel="$-vanna total"
                tone={total >= 0 ? "sky" : "bear"}
                className="col-span-2 lg:col-span-1"
                help={METRIC_HELP.netVex}
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

          {/* ── "How to read dealer positioning" — collapsible explainer (Rank 8).
              Native <details>/<summary> disclosure: keyboard-operable, no JS state,
              brand colors only. Closed by default so it never crowds the desk. */}
          <details className="group mt-3 rounded-xl border border-sky-400/20 bg-[rgba(8,12,20,0.45)] px-4 py-2.5">
            <summary
              className={clsx(
                "flex cursor-pointer list-none items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-sky-300 outline-none",
                "focus-visible:ring-2 focus-visible:ring-sky-400 [&::-webkit-details-marker]:hidden"
              )}
            >
              <span aria-hidden className="text-[11px] transition-transform group-open:rotate-90">▸</span>
              How to read dealer positioning
            </summary>
            <div className="mt-3 space-y-2 text-[12px] leading-relaxed text-sky-100">
              <p>
                <span className="font-semibold text-purple-light">Short gamma</span> (spot below the{" "}
                <span className="font-semibold text-gold">flip</span>): dealers hedge WITH the move, so
                they amplify it — expect vol expansion and trend. <span className="font-semibold text-bull">Long gamma</span>{" "}
                (spot above the flip): dealers hedge AGAINST the move, dampening it — expect range-bound,
                mean-reverting tape. The flip is the regime pivot.
              </p>
              <p>
                The <span className="font-semibold text-gold">call wall</span> (most positive gamma) acts as an
                upside magnet / resistance and a likely pin; the{" "}
                <span className="font-semibold text-bear">put wall</span> (most negative gamma) acts as downside
                support. <span className="font-semibold text-sky-300">Max pain</span> is the OI-gravity strike price
                tends to drift toward into expiration.
              </p>
              <p className="text-sky-300/80">
                Toggle the expiry chips to compare 0DTE positioning (which behaves very differently) against the
                full options stack — the walls and flip recompute for the scope you pick. Market-structure
                analysis, not financial advice.
              </p>
            </div>
          </details>

          {/* ── Main area — single column < lg, 2-col at lg, widened profile
              track at xl+ so the full-bleed width reads intentional on wide
              monitors (the bipolar profile gets more track; the rail fans its
              cards into 2 internal columns below). ──────────────── */}
          <div className="mt-5 grid gap-5 lg:grid-cols-[1.62fr_1fr] xl:grid-cols-[1.85fr_1fr]">
            {/* LEFT (~62–65%): the profile hero with Profile | Shift | Matrix toggle */}
            <div className="min-w-0">
          {/* ── Profile | Shift | Matrix toggle ───────────────────────────
              Keyed on lens so switching GEX↔VEX resets to Profile — the Shift
              tab is GEX-only (VEX migration is future work), so it can't be
              left selected when the lens flips to VEX. */}
          <Tabs key={lens} defaultValue="profile">
            <TabList aria-label={`${isGex ? "GEX" : "VEX"} view`} className="w-fit">
              <Tab value="profile">{isGex ? "Gamma Profile" : "Vanna Profile"}</Tab>
              <Tab value="curve">Curve</Tab>
              {isGex && <Tab value="shift">Shift</Tab>}
              <Tab value="matrix">Matrix</Tab>
            </TabList>

            <TabPanels>
              {/* Hero: exposure profile ladder */}
              <TabPanel value="profile">
                {/* Expiry scope — All · 0DTE · per-expiry (Rank 5). Re-sums the profile
                    + curve client-side over the chosen expiry/expiries. */}
                <ExpiryScopeBar
                  expiries={expiries}
                  zeroDteExpiry={zeroDteExpiry}
                  scope={expiryScope}
                  onScope={setExpiryScope}
                />
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
                  peak={filteredPeak}
                  spot={spot}
                  flip={profileFlip}
                  lens={lens}
                  showFlow={showFlow && hasFlowOverlay}
                  flowPeak={flowPeak}
                  darkPoolLevels={darkPoolLevels}
                  showDarkPool={showDarkPool && hasDarkPoolOverlay}
                />
                <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/75">
                  {isGex
                    ? "Net dealer $-gamma per strike · green long / violet short · "
                    : "Net dealer $-vanna per strike · sky positive / violet negative · "}
                  {scopeLabel} total{" "}
                  <span className={clsx(filteredTotal >= 0 ? posColorClass : "text-purple-light")}>
                    {fmtMoney(filteredTotal)}
                  </span>
                </p>
              </TabPanel>

              {/* Cumulative exposure curve (Rank 12) — running sum of the FILTERED
                  per-strike totals; zero-crossing = flip, short-γ below / long-γ above. */}
              <TabPanel value="curve">
                <ExpiryScopeBar
                  expiries={expiries}
                  zeroDteExpiry={zeroDteExpiry}
                  scope={expiryScope}
                  onScope={setExpiryScope}
                />
                <CumulativeCurve rows={profileRows} spot={spot} flip={profileFlip} lens={lens} />
                <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/75">
                  {isGex
                    ? "Cumulative net dealer $-gamma across strikes · zero-crossing = γ flip · "
                    : "Cumulative net dealer $-vanna across strikes · zero-crossing = vanna flip · "}
                  {scopeLabel} total{" "}
                  <span className={clsx(filteredTotal >= 0 ? posColorClass : "text-purple-light")}>
                    {fmtMoney(filteredTotal)}
                  </span>
                </p>
              </TabPanel>

              {/* Shift: intraday gamma migration (GEX-only) */}
              {isGex && (
                <TabPanel value="shift">
                  {shift && shift.available ? (
                    <>
                      <ShiftView shift={shift} strikes={strikes} spotStrike={spotStrike} />
                      <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/75">
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

                {/* Horizontal-scroll container with a subtle right-edge fade so on
                    phones the mono values scroll instead of colliding. The table gets
                    a min-width so columns keep their breathing room below the fold. */}
                <div className="relative">
                  <div
                    className="overflow-x-auto"
                    role="region"
                    tabIndex={0}
                    aria-label={`${data?.underlying ?? ticker} dealer ${isGex ? "gamma" : "vanna"} exposure matrix, strikes by expiration`}
                  >
                    <table className="w-full min-w-[34rem] border-separate border-spacing-0 font-mono text-[11px]">
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
                                  title={has ? `${strike} · ${fmtExpiry(e)} · ${fmtMoneySigned(v)}` : undefined}
                                >
                                  {has ? fmtMoneySigned(v) : "·"}
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
                              {rowTotal ? fmtMoneySigned(rowTotal) : "·"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                  {/* right-edge scroll fade — hints there's more matrix to the right */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#040407] to-transparent"
                  />
                </div>

                <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/75">
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

            {/* RIGHT (~35–38%): Largo desk read · key levels · flow summary.
                At xl the rail fans KeyLevels + FlowSummary into 2 internal
                columns (Largo spans both) so the rail fills its width with
                substantial content instead of a thin stack. */}
            <aside className="min-w-0 grid content-start gap-4 xl:grid-cols-2">
              {/* ── Largo read — AI desk-read narrative (lazy, keyed by ticker) ── */}
              <div className="xl:col-span-2">
                <LargoRead key={ticker} ticker={ticker} />
              </div>

              <KeyLevels
                levels={
                  isGex
                    ? [
                        { label: "Spot", value: spot > 0 ? spot : null, tone: "cyan", help: METRIC_HELP.spot },
                        { label: "Gamma flip", value: flip, tone: "gold", help: METRIC_HELP.gammaFlip },
                        { label: "Call wall", value: posWall, tone: "bull", help: METRIC_HELP.callWall },
                        { label: "Put wall", value: negWall, tone: "bear", help: METRIC_HELP.putWall },
                        { label: "Max pain", value: maxPain, tone: "sky", help: METRIC_HELP.maxPain },
                      ]
                    : [
                        { label: "Spot", value: spot > 0 ? spot : null, tone: "cyan", help: METRIC_HELP.spot },
                        { label: "Vanna flip", value: flip, tone: "gold", help: METRIC_HELP.vannaFlip },
                        { label: "+Vanna wall", value: posWall, tone: "sky", help: METRIC_HELP.posVannaWall },
                        { label: "−Vanna wall", value: negWall, tone: "violet", help: METRIC_HELP.negVannaWall },
                        { label: "Max pain", value: maxPain, tone: "sky", help: METRIC_HELP.maxPain },
                      ]
                }
                darkPoolLevels={darkPoolLevels}
              />

              <FlowSummary flowByStrike={flowByStrike} />
            </aside>
          </div>

          {/* ── Methodology disclosure — honest about the dealer-sign assumption ── */}
          <p className="mt-5 border-t border-white/8 pt-3 text-[10px] leading-snug text-sky-300/75">
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
