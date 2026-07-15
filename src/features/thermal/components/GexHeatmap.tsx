"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { AnchorGlyph, PanelLabel } from "@/features/thermal/lib/gex-heatmap/primitives";
import { GEX_KING_COMPACT_LABEL, GEX_KING_DUAL_LABEL, GEX_KING_NODE_HELP, gexKingDualLabel } from "@/lib/gex-king-node-labels";
import { shiftPercentForStrike } from "@/features/thermal/lib/gex-heatmap/shift-math";
import { createPulseEventSource, type PulseStreamSnapshot } from "@/lib/api";
import { usePollIntervalMs } from "@/hooks/use-et-market-open";
import { resetIosViewport } from "@/hooks/useIosKeyboardInset";
import { todayEt } from "@/lib/et-date";
import {
  fmtHeatmapExpiry,
  fmtHeatmapMoneySigned,
  fmtHeatmapStrike,
  heatmapCellStyle,
  heatmapCellTextStyle,
  type GexHeatmapLens,
} from "@/lib/gex-heatmap-display";
import {
  readGexHeatmapSessionCache,
  writeGexHeatmapSessionCache,
} from "@/lib/gex-heatmap-session-cache";

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

/**
 * DEX regime read — derived server-side from the net dealer dollar-DELTA sign.
 * 'long' → dealers sell rallies / buy dips (stabilizing); 'short' → amplifies trend.
 */
type DexRegime = {
  posture: "long" | "short" | null;
  read: string;
};

/** CHARM regime read — derived server-side from the net dealer dollar-CHARM sign. */
type CharmRegime = {
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

/**
 * Net dealer dollar-DELTA block (DEX lens). SAME MetricBlock shape as gex/vex except it has a
 * `zero_level` (per-strike net-delta sign-crossing nearest spot) in place of walls/flip/max-pain.
 */
type DexBlock = {
  cells: Record<string, Record<string, number>>;
  strike_totals: Record<string, number>;
  total: number;
  zero_level: number | null;
  regime: DexRegime;
};

/** Net dealer dollar-CHARM block (delta-decay / pinning lens). Same shape as DexBlock. */
type CharmBlock = {
  cells: Record<string, Record<string, number>>;
  strike_totals: Record<string, number>;
  total: number;
  zero_level: number | null;
  regime: CharmRegime;
};

/**
 * Server-computed alert event — a pure diff of the prior history snapshot vs the current sample.
 * Never fabricated client-side; comes free on the already-polled 20s matrix payload.
 */
type GexEvent = {
  type: "flip_crossed" | "wall_broken" | "regime_flipped" | "net_gex_sign_flipped";
  severity: "info" | "warn";
  message: string;
  level?: number;
  direction?: string;
  at: string;
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
  /**
   * Net dealer dollar-DELTA + dollar-CHARM blocks (additive — absent on older caches).
   * Same MetricBlock shape as gex/vex but with `zero_level` instead of walls/flip/max-pain.
   */
  dex?: DexBlock;
  charm?: CharmBlock;
  /** Intraday gamma migration (GEX-only). Present whenever a matrix is returned. */
  shift?: GexShift;
  /** Intraday VANNA migration — same GexShift shape as `shift`. Additive (absent on older caches). */
  vex_shift?: GexShift;
  /**
   * Server-computed alert events for this sample vs the prior snapshot. Additive — absent on
   * cold history (<2 snapshots), empty array when nothing crossed. Never fabricated client-side.
   */
  events?: GexEvent[];
  /**
   * Day-over-day EOD HISTORY context (GEX-anchored — flip/walls/net-GEX are gamma concepts).
   * Present only when ≥1 prior trading-day snapshot exists; absent on cold history (the norm
   * until the EOD cron has run a few sessions). Browser-safe shape — NO engine runtime import.
   * Each delta is null when its prior value is missing, so a partial prior never fabricates a
   * change. Deltas: levels in points (current − prior trading day), net_gex in dollars.
   */
  history_context?: {
    prior_close: {
      date: string;
      flip: number | null;
      call_wall: number | null;
      put_wall: number | null;
      net_gex: number | null;
      max_pain: number | null;
    } | null;
    flip_delta_pts: number | null;
    call_wall_delta_pts: number | null;
    put_wall_delta_pts: number | null;
    net_gex_delta: number | null;
    recent_flip_range: { min: number; max: number } | null;
    recent_spot_range: { min: number; max: number } | null;
    sessions: number;
  };
  overlays?: Overlays;
  /** Overlay sample time (#9) — the dark-pool / flow-by-strike overlays ride a separate ~30s
   *  cache (dark-pool source under it up to ~2min), so they can be staler than the matrix.
   *  Surfaced so the overlay legend can show its own "as of …" instead of implying matrix
   *  freshness. null when no overlays were served. */
  overlays_at?: string | null;
  /** Night Hawk active-play context — present when a NH edition from the last 24h has a play
   *  for this ticker. null when no current play exists. Never fabricated. */
  nighthawk_context?: {
    play_direction: string;
    target_strike: string | number | null;
    grade: string;
    summary: string;
  } | null;
  /** UW oracle cross-check (preset tickers) — same block SPX Slayer matrix surfaces. */
  cross_validation?: {
    callWallMatch: boolean;
    putWallMatch: boolean;
    flipMatch: boolean;
    divergence: number | null;
    uw_asof: string | null;
  } | null;
  error?: string;
};

/** A non-null history_context narrowed for convenience in the GEX-lens render paths. */
type HistoryContext = NonNullable<GexHeatmapResponse["history_context"]>;

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

/**
 * Signed point delta for level moves vs prior close, e.g. "+5.0" / "-12.5" / "held".
 * An exact zero (no change) reads "held" so the chip carries a plain-language meaning.
 * Fractional points round to 1dp; whole points print clean (no trailing ".0" noise on big
 * index strikes is acceptable — we keep 1dp for consistency with the spec's "+5.0").
 */
function fmtPtsDelta(n: number): string {
  if (n === 0) return "held";
  const sign = n > 0 ? "+" : "";
  // Whole numbers print without a decimal; fractional keep 1dp.
  const body = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${sign}${body}`;
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

/**
 * True when a YYYY-MM-DD is a standard US monthly options expiration (the THIRD FRIDAY) — the
 * far-dated columns the server now appends (monthly + quarterly OpEx carry the dominant dealer
 * walls). Mirrors the server's thirdFridayYmd calendar math. Used to classify expiries into the
 * "monthly" horizon and to badge the far-dated matrix columns. Tolerant: a malformed date → false.
 */
function isMonthlyExpiry(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return false;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const dow = first.getUTCDay(); // 0=Sun..6=Sat
  const firstFriday = 1 + ((5 - dow + 7) % 7);
  return d === firstFriday + 14; // third Friday
}

type Lens = "gex" | "vex" | "dex" | "charm";

/**
 * Per-lens color identity (brand tokens only, never grey) — each lens keeps a distinct
 * POSITIVE identity, while the NEGATIVE side is the shared bear-red #ff2d55 across all
 * four lenses (negative exposure is the bearish / short side — semantically red, never
 * the off-brand violet, which is HELIX's identity not Heatmaps'):
 *  - GEX:   positive = bull green #00e676, negative = bear red #ff2d55
 *  - VEX:   positive = sky    #7dd3fc,     negative = bear red #ff2d55
 *  - DEX:   positive = cyan   #22d3ee,     negative = bear red #ff2d55 (net dealer delta)
 *  - CHARM: positive = gold   #ffd23f,     negative = bear red #ff2d55 (delta-decay / pinning)
 */
const LENS_COLORS: Record<Lens, { posRgb: string; negRgb: string; posHex: string; negHex: string }> = {
  gex: { posRgb: "0,230,118", negRgb: "255,45,85", posHex: "#00e676", negHex: "#ff2d55" },
  vex: { posRgb: "125,211,252", negRgb: "255,45,85", posHex: "#7dd3fc", negHex: "#ff2d55" },
  dex: { posRgb: "34,211,238", negRgb: "255,45,85", posHex: "#22d3ee", negHex: "#ff2d55" },
  charm: { posRgb: "255,210,63", negRgb: "255,45,85", posHex: "#ffd23f", negHex: "#ff2d55" },
};

/** Convenience: lenses that carry walls/flip/max-pain (GEX/VEX) vs zero_level lenses (DEX/CHARM). */
function isWallLens(l: Lens): l is "gex" | "vex" {
  return l === "gex" || l === "vex";
}

/**
 * Per-lens display vocabulary — parameterizes the profile / curve / matrix copy so all four
 * lenses share one block-shape-agnostic render path. `pivot`/`pivotShort` name the central
 * divider (γ/vanna flip for GEX/VEX, delta-/charm-zero for DEX/CHARM); `pos`/`neg` name the
 * two halves; `unit` is the noun used in totals. Brand-token colors come from LENS_COLORS.
 */
type LensVocab = {
  /** Short tab + profile title noun, e.g. "Gamma" / "Vanna" / "Delta" / "Charm". */
  noun: string;
  /** The central pivot label, e.g. "γ flip" / "vanna flip" / "δ-zero" / "charm-zero". */
  pivot: string;
  /** Positive-side label, e.g. "long γ" / "pos vanna" / "long δ" / "+charm". */
  pos: string;
  /** Negative-side label, e.g. "short γ" / "neg vanna" / "short δ" / "−charm". */
  neg: string;
  /** Total noun, e.g. "$-gamma" / "$-vanna" / "$-delta" / "$-charm". */
  unit: string;
};

const LENS_VOCAB: Record<Lens, LensVocab> = {
  gex: { noun: "Gamma", pivot: "γ flip", pos: "long γ", neg: "short γ", unit: "$-gamma" },
  vex: { noun: "Vanna", pivot: "vanna flip", pos: "pos vanna", neg: "neg vanna", unit: "$-vanna" },
  dex: { noun: "Delta", pivot: "δ-zero", pos: "long δ", neg: "short δ", unit: "$-delta" },
  charm: { noun: "Charm", pivot: "charm-zero", pos: "+charm", neg: "−charm", unit: "$-charm" },
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
 * The ANCHOR strike = argmax over strikes of |aggregate net exposure| — the single
 * dominant dealer-gamma concentration in the current view (the strongest pin/anchor).
 * Computed from the SAME per-strike totals the caller is rendering (server `strike_totals`
 * for the all-expiry matrix, the client-filtered totals for a scoped profile) so the marker
 * always lands on the bar/row it's looking at.
 *
 * Null-safe + tie-stable: empty input → null; on an exact |value| tie the FIRST strike
 * (lowest, ascending) wins deterministically so the anchor never flickers between equals.
 * Zero-only input (every total 0) → null (no anchor to mark). No Math.random/Date — pure
 * over the passed totals, so it's safe in render (#418).
 */
function anchorStrike(totals: Record<string, number>): number | null {
  let anchor: number | null = null;
  let best = 0;
  // Ascending strike order makes the tie-break deterministic (first/lowest strike wins).
  const entries = Object.entries(totals)
    .map(([s, v]) => ({ strike: Number(s), value: v }))
    .filter((e) => Number.isFinite(e.strike))
    .sort((a, b) => a.strike - b.strike);
  for (const e of entries) {
    const mag = Math.abs(e.value);
    // Strict `>` keeps the first strike on a tie; `mag > 0` skips zero-only totals.
    if (mag > best) {
      best = mag;
      anchor = e.strike;
    }
  }
  return anchor;
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

  // Flip: ascending NEGATIVE→POSITIVE sign crossing nearest spot, linearly interpolated — the
  // structural gamma flip (below it dealers net short, above net long). This MATCHES the server's
  // `computeZeroGammaFlip` (which also keys on neg→pos only); the prior either-direction match
  // could place the filtered-subset divider at a pos→neg crossing the server would never mark.
  let flip: number | null = null;
  let bestDist = Infinity;
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1];
    const b = entries[i];
    if (a.value === 0 || b.value === 0) continue;
    if (a.value < 0 && b.value > 0) {
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
    "The strike with the most positive dealer gamma — an upside anchor that often acts as resistance / a pin as spot approaches.",
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
  deltaZero:
    "The strike where net dealer dollar-delta flips sign — the pivot between stabilizing (long-delta) and trend-amplifying (short-delta) hedging.",
  netDex:
    "Total net dealer dollar-delta. Long → dealers sell rallies / buy dips (mean-reverting, stabilizing); short → they buy rallies / sell dips (trend-amplifying, destabilizing).",
  dexPosture:
    "Net dealer delta sign. Long = stabilizing (dealers fade the move); short = destabilizing (dealers chase the move).",
  charmZero:
    "The strike where net dealer dollar-charm flips sign — the axis of delta-decay pinning pressure that strengthens into OPEX / the close.",
  netCharm:
    "Total net dealer dollar-charm (delta decay). As expiry nears, this passive hedging flow pins price toward heavy strikes — strongest pre-OPEX and end-of-day.",
  charmPosture:
    "Net dealer charm sign. Positive → decay pins price UP toward heavy strikes; negative → it drags price DOWN. Both intensify as expiration approaches.",
} as const;

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
  isPosWall: boolean;
  isNegWall: boolean;
  /** HELIX net premium flow hitting this strike today, or null when no overlay data. */
  flow: FlowByStrike | null;
};

/** Dark-pool overlay colors — two on-brand NEUTRAL tones (sky / cyan) so alternating
 *  levels stay distinguishable without the off-brand violet. Brand tokens, never grey. */
const DARK_POOL_HEX = "#7dd3fc";
const DARK_POOL_ALT_HEX = "#22d3ee";

function ExposureProfile({
  rows,
  peak,
  spot,
  flip,
  anchorStrike: anchor,
  lens,
  showFlow,
  flowPeak,
  darkPoolLevels,
  showDarkPool,
  shift,
}: {
  rows: ProfileRow[];
  peak: number;
  spot: number;
  flip: number | null;
  /**
   * The ANCHOR strike — the dominant dealer-gamma concentration (max |net| in this
   * scope). The row on this strike gets a white ◆ marker + "ANCHOR" label + bright-white
   * ring, marking the strongest pin/anchor on top of its emerald/bear magnitude bar. Null
   * when there's nothing to mark (empty / all-zero scope).
   */
  anchorStrike: number | null;
  lens: Lens;
  showFlow: boolean;
  flowPeak: number;
  darkPoolLevels: DarkPoolLevel[] | null;
  showDarkPool: boolean;
  /**
   * Intraday migration for THIS lens (GEX reads data.shift, VEX reads data.vex_shift; DEX/CHARM
   * have none). Drives the inline %-built/melted badge next to each strike's value — same
   * `delta_by_strike` the Shift tab renders, just surfaced inline so the momentum a trader would
   * otherwise open a second tab for is visible at a glance. Null/unavailable → no badge (never
   * fabricate a shift).
   */
  shift?: GexShift | null;
}) {
  const c = LENS_COLORS[lens];

  // ── Auto-center on the SPOT row (the anchoring) ──────────────────────────────
  // The ladder lists strikes high→low, so it opens at the top (highest strikes) and the
  // spot/flip zone — the actionable part — sits below the fold. The rows live inside a
  // BOUNDED internal scroller (scrollBoxRef) so we center the spot row WITHIN that box —
  // we never touch the page scroll, so the header + key-level cards stay put on load.
  // Keyed on the spot STRIKE (not every 20s refresh) so a quiet refresh never re-yanks it.
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLDivElement | null>(null);
  const spotRowStrike = useMemo(() => {
    const r = rows.find((row) => row.isSpot);
    return r ? r.strike : null;
  }, [rows]);
  useEffect(() => {
    // Client-only, after layout. Guard both refs so it never throws when the spot row isn't
    // rendered (spot off the strike band, or too few strikes) or the box hasn't mounted.
    if (spotRowStrike == null) return;
    // Double rAF: wait for the rows to be laid out at their FINAL positions before we
    // measure offsetTop — a single frame can fire before the bars have their final heights,
    // landing us short of spot. Two frames is the safe "layout settled" point.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const box = scrollBoxRef.current;
        const row = spotRowRef.current;
        if (box == null || row == null) return;
        // Center the spot row inside the bounded box ONLY — never scrollIntoView (which
        // would walk up to the page). Clamp is implicit: the browser caps scrollTop.
        box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [spotRowStrike]);

  // Index of the divider: drawn ABOVE the first row (strikes desc) whose strike < flip.
  const flipBoundary = useMemo(() => {
    if (flip == null) return -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].strike < flip) return i;
    }
    return -1;
  }, [rows, flip]);

  // SPOT reference line — drawn ABOVE the first row (strikes desc) whose strike < spot,
  // i.e. between the strikes that bracket the live price. Mirrors the flip divider so a
  // trader instantly places price in the structure (the Curve view draws the same line).
  const spotBoundary = useMemo(() => {
    if (!(spot > 0)) return -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].strike < spot) return i;
    }
    return -1;
  }, [rows, spot]);

  // The row index that sits ON the gamma-flip strike — faint bg tint so the flip row pops
  // (the spot row already carries its cyan outline tint via r.isSpot).
  const flipRowIdx = useMemo(() => {
    if (flip == null || rows.length === 0) return -1;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const d = Math.abs(rows[i].strike - flip);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
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

  const v = LENS_VOCAB[lens];
  const flipLabel = v.pivot;
  const profileLabel = `Net dealer ${v.noun.toLowerCase()} profile by strike — positive bars right of center, negative left`;

  return (
    <div role="img" aria-label={profileLabel}>
      {/* Bounded internal scroller — the strike rows scroll INSIDE this box (centered on
          spot via scrollBoxRef) so the page never moves on load. Height shows ~the spot±walls
          band (≈18-26 strikes) comfortably; overscroll-contain stops the scroll chaining back
          to the page at the band edges. Only the rows scroll — the legends below stay fixed.
          Retuned to ~clamp(360px,56vh,600px) — in the paired "Profile + Matrix" view it shares
          the viewport with the matrix, so it's sized to match (Step 3). */}
      <div
        ref={scrollBoxRef}
        className="max-h-[clamp(360px,56vh,600px)] space-y-px overflow-y-auto overscroll-contain pr-1"
      >
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
        // ANCHOR — the dominant net-exposure strike in this scope. Bright-white marker +
        // ring sit ON TOP of the bar's own emerald/bear magnitude color (white ≠ magnitude;
        // gold is freed for the +GEX peak in the matrix).
        const isAnchor = anchor != null && r.strike === anchor;

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

        // ── Shift badge: intraday %-built/melted for this strike, inline (mirrors the
        // Shift tab's build=green/melt=red convention: built = delta > 0). ──
        const shiftDelta = shift?.available ? shift.delta_by_strike?.[String(r.strike)] : null;
        const shiftPct = shiftPercentForStrike(r.value, shiftDelta);
        const shiftBuilt = shiftDelta != null && shiftDelta > 0;
        const shiftHex = shiftBuilt ? SHIFT_BUILD_HEX : SHIFT_MELT_HEX;

        return (
          // Tag the spot strike row's wrapper with the ref so the auto-center effect can
          // scroll it into view. Only the spot row carries it (one ref, no per-row churn).
          <div key={r.strike} ref={r.isSpot ? spotRowRef : undefined}>
            {/* SPOT reference line between the bracketing strikes — cyan, mirrors the
                Curve view's spot marker so price is instantly placeable in the ladder. */}
            {spot > 0 && i === spotBoundary && (
              <div className="flex items-center gap-2 py-1" aria-hidden>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_10px_#22d3ee]" />
                <span className="whitespace-nowrap font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-cyan-400">
                  spot {fmtSpot(spot)}
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_10px_#22d3ee]" />
              </div>
            )}

            {/* flip divider between the bracketing strikes */}
            {flip != null && i === flipBoundary && (
              <div className="flex items-center gap-2 py-1" aria-hidden>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold to-transparent shadow-[0_0_10px_#ffd23f]" />
                <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.2em] text-gold">
                  {/* flipLabel is the lens's full pivot noun ("γ flip" / "vanna flip" / "δ-zero" /
                      "charm-zero") — no hardcoded γ prefix: it doubled on GEX ("γ γ flip") and was
                      flat wrong on every other lens ("γ vanna flip"). */}
                  {flipLabel} {fmtStrike(flip)}
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold to-transparent shadow-[0_0_10px_#ffd23f]" />
              </div>
            )}

            <div
              className={clsx(
                "group relative flex items-center gap-2 rounded-sm py-0.5 pr-1",
                // ANCHOR ring wins the row treatment (the dominant node should pop hardest):
                // a bright-white 2px outline + white wash, distinct from the spot row's cyan
                // outline (and from the gold now reserved for the +GEX peak).
                isAnchor
                  ? "outline outline-2 outline-white/85 bg-white/[0.10]"
                  : r.isSpot
                    ? "outline outline-1 outline-cyan-400/70 bg-cyan-400/[0.06]"
                    : i === flipRowIdx && "bg-gold/[0.06]"
              )}
              style={isAnchor ? { boxShadow: "inset 0 0 18px rgba(255,255,255,0.12)" } : undefined}
              title={
                isAnchor
                  ? `${GEX_KING_DUAL_LABEL} · ${fmtStrike(r.strike)} · ${fmtMoney(r.value)} — ${GEX_KING_NODE_HELP}`
                  : `${fmtStrike(r.strike)} · ${fmtMoney(r.value)}`
              }
            >
              {/* strike label (left gutter) — compacted (w-12) so the bar keeps room
                  in the now-narrower ~33% Profile column (UI refactor). */}
              <span
                className={clsx(
                  "w-12 shrink-0 text-right font-mono text-[11px] tabular-nums",
                  isAnchor
                    ? "font-bold text-white"
                    : r.isSpot
                      ? "font-bold text-white"
                      : wall
                        ? "font-semibold text-gold"
                        : "text-sky-300"
                )}
              >
                <span className="inline-flex items-center justify-end gap-1">
                  {/* ANCHOR pin — bright-white ◆ diamond glyph, the unmistakable dominant-node marker. */}
                  {isAnchor && (
                    <span className="text-white" title={GEX_KING_NODE_HELP}>
                      <AnchorGlyph size={11} />
                    </span>
                  )}
                  {r.isSpot && !isAnchor && <span className="text-cyan-400">●</span>}
                  {fmtStrike(r.strike)}
                </span>
              </span>

              {/* bipolar bar track with a center axis — `flex-1` fills the column, so in the
                  narrowed ~33% Profile column it compresses to fit. The max-w cap is relaxed
                  (clamp 160→28vw→360) so the bar still reads in the slimmer column. */}
              <span className="relative h-5 flex-1 max-w-[clamp(160px,28vw,360px)]">
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
                    // ANCHOR bar keeps its emerald/bear magnitude fill, but gets a bright-white
                    // ring + glow on TOP so the dominant node is unmistakable. The ring is an
                    // outline (static, opacity-only glow) — reduced-motion safe.
                    outline: isAnchor ? "1.5px solid #ffffff" : undefined,
                    boxShadow: isAnchor
                      ? "0 0 12px rgba(255,255,255,0.85)"
                      : wall
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

              {/* signed value — sits INLINE just past the bar end (left-aligned, not pinned
                  to the far edge) so the eye doesn't cross a void. Tinted by lens identity. */}
              <span
                className="w-20 shrink-0 text-left font-mono text-[11px] font-semibold tabular-nums"
                style={{ color: r.value === 0 ? undefined : positive ? c.posHex : c.negHex }}
              >
                {fmtMoneySigned(r.value)}
              </span>
              {/* Intraday shift badge — small colored pill, same build(green)/melt(red)
                  convention as the Shift tab. Omitted (not zeroed) when unavailable so a
                  quiet/collecting shift window never renders a fabricated "0%". */}
              {shiftPct != null && (
                <span
                  className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px] font-bold tabular-nums"
                  style={{ color: shiftHex, backgroundColor: `${shiftHex}22` }}
                  title={`${fmtStrike(r.strike)} · ${shiftBuilt ? "built" : "melted"} ${fmtMoney(shiftDelta ?? 0)} vs ${fmtElapsed(shift?.since_ms ?? 0)} ago`}
                >
                  {shiftPct >= 0 ? "+" : ""}
                  {shiftPct.toFixed(0)}%
                </span>
              )}
              <span className="ml-auto w-16 shrink-0 text-left">
                {/* ANCHOR tag — leads the row's tag slot when this is the dominant node. */}
                {isAnchor && (
                  <span className="inline-flex items-center gap-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-white">
                    <AnchorGlyph size={9} /> {GEX_KING_COMPACT_LABEL}
                  </span>
                )}
                {/* Wall tags only exist on GEX/VEX (DEX/CHARM have no walls → these never fire). */}
                {!isAnchor && r.isPosWall && (
                  <span className="font-mono text-[8px] uppercase tracking-wider text-gold">
                    {lens === "gex" ? "call" : "+vex"}
                  </span>
                )}
                {!isAnchor && r.isNegWall && (
                  <span className="font-mono text-[8px] uppercase tracking-wider text-gold">
                    {lens === "gex" ? "put" : "−vex"}
                  </span>
                )}
                {!isAnchor && flow != null && netFlow !== 0 && !r.isPosWall && !r.isNegWall && (
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
      </div>

      {/* axis legend */}
      <div className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/70">
        <span style={{ color: c.negHex }}>
          ◀ {v.neg} (−)
        </span>
        <span
          className="text-sky-300"
          title={spot > 0 ? "Profile reflects the 20s snapshot; the header price updates live." : undefined}
        >
          {spot > 0 ? `spot ${fmtStrike(spot)}` : `net dealer ${v.noun.toLowerCase()}`}
        </span>
        <span style={{ color: c.posHex }}>
          {v.pos} (+) ▶
        </span>
      </div>

      {/* ANCHOR legend — explains the white ◆ marker (the dominant node). Only when one
          is marked in the rendered scope. */}
      {anchor != null && (
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white">
          <AnchorGlyph size={10} />
          {GEX_KING_DUAL_LABEL} · {fmtStrike(anchor)} — {GEX_KING_NODE_HELP}
        </div>
      )}

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

  const v = LENS_VOCAB[lens];
  const label = `Cumulative net dealer ${v.noun.toLowerCase()} across strikes — zero-crossing is the ${v.pivot}; ${v.neg} below, ${v.pos} above`;
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

        {/* long-gamma fill (above zero) — the lens's positive identity */}
        <path d={geom.areaPath} fill={c.posHex} fillOpacity={0.16} clipPath={`url(#${clipBullId})`} />
        {/* short-gamma fill (below zero) — bear-red identity */}
        <path d={geom.areaPath} fill={c.negHex} fillOpacity={0.16} clipPath={`url(#${clipBearId})`} />

        {/* the cumulative line itself — NEUTRAL sky so it reads as the running-sum
            trace, not the call-wall gold. The colored area fill (emerald above the
            flip, bear-red below) already carries the directional meaning; the line
            stays a calm anchor that doesn't clash with the gold flip marker. */}
        <path
          d={geom.linePath}
          fill="none"
          stroke="#7dd3fc"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 3px rgba(125,211,252,0.5))" }}
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
              {v.pivot}
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

      {/* identity legend — negative vs positive halves */}
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/70">
        <span style={{ color: c.negHex }}>
          {v.neg} (below {v.pivot})
        </span>
        <span style={{ color: c.posHex }}>
          {v.pos} (above {v.pivot})
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
  lens,
}: {
  shift: GexShift;
  strikes: number[];
  spotStrike: number | null;
  /** Lens whose migration this is — drives the "γ flip" vs "vanna flip" / Δ-noun labels. */
  lens: Lens;
}) {
  const v = LENS_VOCAB[lens];
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
          <span className="text-[9px] uppercase tracking-[0.2em] text-sky-300/60">{v.pivot}</span>
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

      {/* Δ ladder — built (right, green) vs melted (left, red) */}
      <div role="img" aria-label={`Intraday Δ dealer-${v.noun.toLowerCase()} by strike — built right (green), melted left (red)`} className="space-y-px">
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
        <span className="text-sky-300">{`Δ dealer ${v.noun.toLowerCase()}`}</span>
        <span style={{ color: SHIFT_BUILD_HEX }}>built (+) ▶</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticker switcher — ONE compact searchable combobox (UI refactor). Replaces the
// old full-width preset-chip + search row: a single pill shows the active ticker
// (+ a small live spot beside it) and opens a type-to-search dropdown. The dropdown
// keeps the EXACT preset set (filtered as you type) AND the search-any-ticker
// capability wired to /api/market/ticker-search. Brand colors only, never grey;
// keyboard-operable (↑/↓/Enter/Escape), closes on outside click.
// ---------------------------------------------------------------------------

function TickerSwitcher({
  ticker,
  onPick,
  spot,
  changePct,
  showSpot,
  nativeShell = false,
}: {
  ticker: string;
  onPick: (t: string) => void;
  /** Live spot beside the selector — the ONE kept clean header spot reference. */
  spot?: number;
  changePct?: number;
  showSpot?: boolean;
  /** iOS native shell — bottom sheet picker instead of fixed dropdown (avoids focus zoom + layout break). */
  nativeShell?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  );

  const updateMenuPos = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 6,
      left: rect.left,
      width: Math.max(rect.width, 256),
    });
  }, []);

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
  const searchResults = searchData?.results ?? [];

  // Preset set filtered by the typed query — keeps the exact PRESET_TICKERS list
  // as the always-available default options, narrowing as you type.
  const q = query.trim().toUpperCase();
  const presetMatches = useMemo(
    () => (q ? PRESET_TICKERS.filter((t) => t.startsWith(q)) : PRESET_TICKERS),
    [q]
  );
  // Combined option list (presets first, then remote matches not already shown).
  // This flat list drives the keyboard cursor + Enter selection.
  const options = useMemo(() => {
    const seen = new Set(presetMatches);
    const opts: { ticker: string; name?: string; preset: boolean }[] = presetMatches.map((t) => ({
      ticker: t,
      preset: true,
    }));
    for (const r of searchResults) {
      const sym = r.ticker.toUpperCase();
      if (!seen.has(sym)) {
        seen.add(sym);
        opts.push({ ticker: sym, name: r.name, preset: false });
      }
    }
    return opts;
  }, [presetMatches, searchResults]);

  // Close the dropdown on outside click (trigger + portaled menu). Native sheet uses backdrop.
  useEffect(() => {
    if (!open || nativeShell) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, nativeShell]);

  useEffect(() => {
    if (!nativeShell || !open) return;
    document.documentElement.classList.add("nav-locked", "gex-ticker-sheet-open");
    return () => {
      document.documentElement.classList.remove("nav-locked", "gex-ticker-sheet-open");
      window.setTimeout(() => resetIosViewport(), 160);
    };
  }, [nativeShell, open]);

  const closeNativeSheet = useCallback(() => {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    window.setTimeout(() => resetIosViewport(), 160);
  }, []);

  useLayoutEffect(() => {
    if (!open || nativeShell) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
  }, [open, nativeShell, updateMenuPos]);

  useEffect(() => {
    if (!open || nativeShell) return;
    const onReflow = () => updateMenuPos();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, nativeShell, updateMenuPos]);

  // Reset the keyboard cursor to the top whenever the option set changes.
  useEffect(() => {
    setActive(0);
  }, [query, open]);

  function pick(t: string) {
    const sym = t.trim().toUpperCase();
    if (!sym) return;
    onPick(sym);
    if (nativeShell) closeNativeSheet();
    else {
      setQuery("");
      setDebouncedQuery("");
      setOpen(false);
    }
  }

  function openMenu() {
    setOpen(true);
    // Focus the search field on the next frame so typing starts immediately.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const changeBull = (changePct ?? 0) >= 0;

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[active] ?? options[0];
      if (opt) pick(opt.ticker);
      else if (query.trim()) pick(query);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(0, options.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      if (nativeShell) closeNativeSheet();
      else setOpen(false);
    }
  }

  const optionList = (
    <ul
      id="ticker-listbox"
      role="listbox"
      aria-label="Tickers"
      className={clsx(
        nativeShell
          ? "gex-ticker-native-sheet-list"
          : "mt-1 max-h-60 overflow-y-auto overscroll-contain"
      )}
    >
      {options.length === 0 ? (
        <li className="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-sky-300/60">
          No matches
        </li>
      ) : (
        options.map((o, i) => {
          const isActive = i === active;
          const isCurrent = o.ticker === ticker;
          return (
            <li key={o.ticker} id={`ticker-opt-${i}`} role="option" aria-selected={isCurrent}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.ticker)}
                className={clsx(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
                  nativeShell ? "gex-ticker-native-sheet-option min-h-[var(--ios-touch,2.75rem)]" : "",
                  isActive ? "bg-cyan-400/12" : "hover:bg-cyan-400/10"
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={clsx(
                      "font-mono font-semibold",
                      nativeShell ? "text-sm" : "text-[12px]",
                      isCurrent ? "text-cyan-400" : "text-white"
                    )}
                  >
                    {o.ticker}
                  </span>
                  {o.preset && (
                    <span className="font-mono text-[8px] uppercase tracking-wider text-sky-300/50">
                      preset
                    </span>
                  )}
                </span>
                {o.name && (
                  <span className={clsx("truncate text-sky-300/70", nativeShell ? "text-xs" : "text-[10px]")}>
                    {o.name}
                  </span>
                )}
              </button>
            </li>
          );
        })
      )}
    </ul>
  );

  const searchInput = (
    <input
      ref={inputRef}
      type="text"
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        setOpen(true);
      }}
      onKeyDown={onSearchKeyDown}
      onBlur={() => {
        if (!nativeShell) return;
        window.setTimeout(() => {
          if (!document.documentElement.classList.contains("ios-keyboard-open")) {
            resetIosViewport();
          }
        }, 160);
      }}
      placeholder="Search any ticker…"
      aria-label="Search any ticker"
      role="combobox"
      aria-expanded={open}
      aria-controls="ticker-listbox"
      aria-activedescendant={open && options.length ? `ticker-opt-${active}` : undefined}
      spellCheck={false}
      autoComplete="off"
      className={clsx(
        nativeShell
          ? "gex-ticker-native-sheet-search"
          : "w-full rounded-md border border-white/12 bg-[rgba(4,6,10,0.7)] px-2.5 py-1.5 font-mono text-[12px] text-white placeholder:text-sky-300/40 outline-none focus-visible:border-sky-400/60 focus-visible:ring-1 focus-visible:ring-sky-400/50"
      )}
    />
  );

  const nativeSheet =
    nativeShell && open ? (
      <div
        ref={menuRef}
        className="gex-ticker-native-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Select ticker"
      >
        <button
          type="button"
          className="gex-ticker-native-sheet-backdrop"
          aria-label="Close ticker search"
          onClick={closeNativeSheet}
        />
        <div className="gex-ticker-native-sheet-panel">
          <div className="gex-ticker-native-sheet-grabber" aria-hidden />
          <p className="gex-ticker-native-sheet-title">Select ticker</p>
          {searchInput}
          {optionList}
        </div>
      </div>
    ) : null;

  const dropdown =
    !nativeShell && open && menuPos ? (
      <div
        ref={menuRef}
        className="fixed z-[200] rounded-lg border border-white/12 bg-[rgba(8,9,14,0.97)] p-1.5 shadow-xl backdrop-blur"
        style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
      >
        {searchInput}
        {optionList}
      </div>
    ) : null;

  return (
    <>
      <div ref={boxRef} className="relative z-[1] flex items-center gap-2">
      {/* Compact trigger — active ticker + caret. Opens the search dropdown. */}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Ticker: ${ticker}. Change ticker`}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-md border border-white/12 bg-[rgba(8,9,14,0.6)] px-2.5 py-1.5 outline-none transition-colors",
          "hover:border-sky-400/50 focus-visible:ring-2 focus-visible:ring-sky-400",
          nativeShell && "gex-ticker-native-trigger min-h-[var(--ios-touch,2.75rem)]"
        )}
      >
        <span aria-hidden className="text-sky-300/70">🔍</span>
        <span className="font-mono text-[12px] font-bold tracking-wide text-white">{ticker}</span>
        <span aria-hidden className="text-[9px] leading-none text-sky-300/60">▾</span>
      </button>

      {/* The ONE kept clean spot reference — small, beside the selector. */}
      {showSpot && spot != null && spot > 0 && (
        <span
          className="flex items-baseline gap-1.5 font-mono"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="sr-only">
            {ticker} {fmtSpot(spot)}, {changeBull ? "up" : "down"}{" "}
            {fmtPct(changePct ?? 0)}
          </span>
          <span aria-hidden className="text-[13px] font-bold tabular-nums text-white">
            {fmtSpot(spot)}
          </span>
          {changePct != null && (
            <span
              aria-hidden
              className={clsx(
                "text-[10px] font-bold tabular-nums",
                changeBull ? "text-bull" : "text-bear"
              )}
            >
              {fmtPct(changePct)}
            </span>
          )}
        </span>
      )}

      </div>
      {typeof document !== "undefined" && (nativeSheet || dropdown)
        ? createPortal(nativeSheet ?? dropdown, document.body)
        : null}
    </>
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

/** Seconds-precision ET time for the matrix freshness chip (traders read the grid directly,
 *  so the matrix's own sample time must be visible — not buried in the Largo panel). */
function fmtAsofSeconds(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

/** The matrix is on a 20s cache; tint the freshness chip amber once the sample is older than
 *  ~2× that window so a sitting-stale grid (e.g. an off-warm-preset ticker) is visibly flagged. */
const MATRIX_STALE_MS = 40_000;

/** Always-visible "as of HH:MM:SS ET" freshness anchor for the matrix header. Renders null when
 *  there is no usable timestamp so it never fabricates freshness. */
function MatrixFreshness({ asof }: { asof: string | undefined }) {
  const label = fmtAsofSeconds(asof);
  if (!label) return null;
  const t = asof ? new Date(asof).getTime() : NaN;
  const stale = Number.isFinite(t) && Date.now() - t > MATRIX_STALE_MS;
  return (
    <span
      className={clsx(
        "flex items-center gap-1.5 tabular-nums normal-case",
        stale ? "text-gold/90" : "text-sky-300/75"
      )}
      title={stale ? "Matrix sample is older than its 20s refresh window" : "Matrix sample time"}
    >
      <span aria-hidden>{stale ? "◷" : "●"}</span>
      <span>as of {label} ET</span>
    </span>
  );
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
// Key-level tone palette — semantic color identity by meaning (walls gold, flip
// cyan, support/net bear-or-bull, max-pain sky). Consumed by the consolidated
// CompactLevel cells below. Brand tokens only, never grey.
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

/**
 * Optional "vs prior close" delta chip on a key-level cell. `text` is the already-formatted
 * change (e.g. "+5.0", "held", "+$1.2M"); `tone` colors it bull/bear/neutral. "held"
 * (no change) reads neutral sky. Rendered as a tiny chip on the CompactLevel cell — never
 * fabricated (callers pass `delta` only when a real prior value exists).
 */
type TileDelta = { text: string; tone: "bull" | "bear" | "neutral"; note?: string };

const TILE_DELTA_HEX: Record<TileDelta["tone"], string> = {
  bull: "#00e676",
  bear: "#ff2d55",
  neutral: "#7dd3fc",
};

// ---------------------------------------------------------------------------
// Key levels — a compact, right-aligned list of the structural price lines
// (spot, flip, walls, max pain) + dark-pool levels. Always-useful rail content.
// ---------------------------------------------------------------------------

/**
 * Dark-pool levels rail card. The structural key levels (spot / flip / call wall / put
 * wall / max pain) live ONLY in the consolidated top key-level box now — the old rail
 * "KEY LEVELS" list duplicated them, so it was dropped. Dark-pool price levels, however,
 * appear NOWHERE in the top box, so they keep their own focused card here (the top-N by
 * notional). Renders nothing when there's no dark-pool data, letting the rail breathe.
 */
function DarkPoolRail({ darkPoolLevels }: { darkPoolLevels: DarkPoolLevel[] | null }) {
  const dp = (darkPoolLevels ?? [])
    .slice()
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 4);
  if (dp.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] px-4 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
          Dark-pool levels
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/75">
          notional
        </span>
      </div>
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
  );
}

// ---------------------------------------------------------------------------
// Flow summary — net premium tilt for the ticker today (bull calls / bear puts),
// derived from the per-strike HELIX overlay. Compact rail card.
// ---------------------------------------------------------------------------

function FlowSummary({
  flowByStrike,
  overlaysLoaded,
}: {
  flowByStrike: Record<string, FlowByStrike> | null;
  /** True once the heatmap response has arrived (distinguishes "loading" from "unavailable"). */
  overlaysLoaded?: boolean;
}) {
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

  // When overlays have been loaded but this ticker has no flow overlay data, show a muted
  // indicator instead of silently hiding the card — so the user knows the HELIX card area
  // is working and this ticker simply isn't in the flow overlay allowlist.
  if (!flowByStrike || Object.keys(flowByStrike).length === 0) {
    if (!overlaysLoaded) return null; // still loading — stay quiet
    return (
      <div className="rounded-xl border border-white/5 bg-[rgba(8,9,14,0.35)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge tone="neutral" size="sm">HELIX</Badge>
          <span className="font-mono text-[11px] text-sky-300/50">
            Flow overlay unavailable for this ticker
          </span>
        </div>
      </div>
    );
  }

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
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-bear-text">Puts</span>
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
  monthlyExpiries,
  scope,
  onScope,
}: {
  expiries: string[];
  zeroDteExpiry: string | null;
  /** The far-dated standard-monthly (3rd-Friday) expiries present in the axis (may be empty). */
  monthlyExpiries: string[];
  scope: string;
  onScope: (s: string) => void;
}) {
  if (expiries.length === 0) return null;
  // 0DTE is redundant when there's a single expiry (it IS the only one) — hide it then.
  const showZeroDte = zeroDteExpiry != null && expiries.length > 1;
  // Horizon presets only make sense once the axis actually spans near AND far columns.
  const hasMonthly = monthlyExpiries.length > 0;
  const nearCount = expiries.length - monthlyExpiries.length;
  const showHorizon = hasMonthly && nearCount > 0;

  const chip = (value: string, label: string, title: string, far = false) => {
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
            // Far-dated (monthly) per-expiry chips carry a faint gold tint so the OpEx columns
            // read as a distinct horizon from the near-term dailies/weeklies. Brand gold, no grey.
            : far
              ? "text-gold/80 hover:bg-gold/[0.08] hover:text-gold"
              : "text-sky-300/70 hover:bg-white/[0.06] hover:text-white"
        )}
      >
        {label}
      </button>
    );
  };

  // Whether a narrowed scope is active — drives the clarifying caption below. The scope filter
  // applies ONLY to the profile + cumulative curve; the regime tiles and key levels stay
  // server-authoritative (near-term) by design, so we say so to avoid a scope/levels mismatch
  // reading as a bug.
  const scoped = scope !== "all";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/60">
        Expiry
      </span>
      {chip("all", "All", "All expiries — near-term + far-dated monthly/quarterly OpEx")}
      {showZeroDte &&
        chip(
          "0dte",
          "0DTE",
          `Nearest expiry${zeroDteExpiry ? ` (${fmtExpiry(zeroDteExpiry)})` : ""} — today's positioning`
        )}
      {/* Horizon presets — only when the axis spans both near AND far columns. */}
      {showHorizon &&
        chip("near", "Near", "Near-term dailies / weeklies only (the ~next 2 weeks)")}
      {showHorizon &&
        chip(
          "monthly",
          "Monthly",
          "Standard monthly + quarterly OpEx only — where the dominant dealer walls park",
          true
        )}
      {expiries.map((e) =>
        chip(e, fmtExpiry(e), `${fmtExpiry(e)} positioning only`, isMonthlyExpiry(e))
      )}
      {scoped && (
        <span
          className="ml-1 font-mono text-[9px] normal-case tracking-normal text-sky-300/50"
          title="Scope narrows the profile bars and cumulative curve. Regime tiles and key levels stay near-term (server-authoritative)."
        >
          filters profile &amp; curve · tiles &amp; levels stay near-term
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts strip (Rank 4c) — compact, dismissible row of server-computed events that
// rides on the already-polled 20s matrix payload (ZERO extra fetch). `warn` reads
// bear/amber, `info` reads sky. Relative "Xm ago" is computed client-side from the
// event `at` timestamp. Reduced-motion safe: a gentle motion-safe pulse on the worst
// chip only; reduced-motion users get a static strip. Renders nothing when empty.
// ---------------------------------------------------------------------------

/** Relative "just now" / "2m ago" / "1h ago" from an ISO timestamp. Never throws. */
function fmtRelative(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, nowMs - t);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m ago` : `${h}h ago`;
}

/** Glyph by event type — ⚡ for crosses/breaks, ▲/▼ for directional flips, • fallback. */
function eventGlyph(e: GexEvent): string {
  if (e.type === "wall_broken" || e.type === "flip_crossed") return "⚡";
  const d = (e.direction ?? "").toLowerCase();
  if (d.includes("above") || d.includes("long") || d.includes("positive") || d.includes("up")) return "▲";
  if (d.includes("below") || d.includes("short") || d.includes("negative") || d.includes("down")) return "▼";
  return "•";
}

function AlertsStrip({ events }: { events: GexEvent[] }) {
  // Dismissed locally; re-keyed by the event signature so a NEW event re-opens the strip.
  const [dismissed, setDismissed] = useState(false);
  const sig = useMemo(() => events.map((e) => `${e.type}@${e.at}`).join("|"), [events]);
  const lastSigRef = useRef(sig);
  // A fresh batch (new signature) clears the dismissal so a new cross is never hidden.
  if (sig !== lastSigRef.current) {
    lastSigRef.current = sig;
    if (dismissed) setDismissed(false);
  }

  // `nowMs` recomputed each render; the 20s matrix poll re-renders the parent, keeping
  // "Xm ago" reasonably fresh without a dedicated timer (no extra interval needed).
  const nowMs = Date.now();

  if (events.length === 0 || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] px-3 py-2.5"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
            Positioning alerts
          </span>
          <Badge tone="accent" size="sm">
            {events.length}
          </Badge>
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss positioning alerts"
          className={clsx(
            "rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider outline-none transition-colors",
            "text-sky-300/70 hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-sky-400"
          )}
        >
          Dismiss ✕
        </button>
      </div>
      <ul className="space-y-1.5">
        {events.map((e, i) => {
          const warn = e.severity === "warn";
          // warn → bear red / amber accent; info → sky.
          const hex = warn ? "#ff2d55" : "#7dd3fc";
          const rel = fmtRelative(e.at, nowMs);
          return (
            <li
              key={`${e.type}-${e.at}-${i}`}
              className={clsx(
                "flex items-start gap-2.5 rounded-lg border px-3 py-1.5",
                warn
                  ? "border-bear/35 bg-bear/[0.06]"
                  : "border-sky-400/25 bg-sky-400/[0.05]"
              )}
              style={warn ? { boxShadow: "inset 0 0 14px rgba(255,45,85,0.05)" } : undefined}
            >
              <span
                aria-hidden
                className={clsx("mt-px shrink-0 text-[12px] leading-none", warn && "motion-safe:animate-pulse")}
                style={{ color: hex }}
              >
                {eventGlyph(e)}
              </span>
              <span className="min-w-0 flex-1 text-[12px] leading-snug" style={{ color: warn ? "#ffd6de" : "#dff1ff" }}>
                {e.message}
              </span>
              {rel && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-sky-300/70">
                  {rel}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key-level box (consolidated) — ONE compact bordered panel of small label-over-
// value cells, replacing the old ~6 big RegimeTile cards that ate vertical space.
// Mirrors the SpxSniperHeader metric-block pattern: a tight grid of tiny cells in
// a single grouped box. Values stay semantically colored (call=emerald, put=bear,
// flip/max-pain=sky, net by sign). The ANCHOR cell is visually DISTINCT (bright-white-
// accented, ◆ anchor glyph) so the dominant node still pops inside the box.
// Brand tokens only, never grey; reduced-motion safe (static, opacity-only chrome).
// ---------------------------------------------------------------------------

/** One compact key-level cell — label over value, tinted by tone. The anchor cell
 *  carries a bright-white accent + ◆ glyph so it reads distinctly inside the grouped box. */
type LevelCell = {
  /** Stable key for the cell (also drives React keys). */
  key: string;
  label: string;
  value: string;
  /** Color identity — reuses the RegimeTile tone palette (flip/wall/support/sky/bull/bear). */
  tone: TileTone;
  /** Dim the cell when its level is absent (value "—") so empty levels recede. */
  active?: boolean;
  /** Plain-language explainer surfaced via the accessible InfoTip. */
  help?: string;
  /** Day-over-day "vs prior close" delta chip (GEX history) — never fabricated. */
  delta?: TileDelta | null;
  /** The ANCHOR cell — bright-white-accented, distinct, leads with the ◆ glyph. */
  anchor?: boolean;
};

function CompactLevel({ cell }: { cell: LevelCell }) {
  const t = TILE_TONE[cell.tone];
  const active = cell.active ?? true;
  return (
    <div
      className={clsx(
        "relative flex min-w-0 flex-col gap-0.5 rounded-lg border px-2.5 py-1.5",
        cell.anchor
          ? "border-white/45 bg-[rgba(12,13,16,0.6)]"
          : active
            ? clsx(t.border, "bg-[rgba(8,9,14,0.55)]")
            : "border-white/10 bg-[rgba(8,9,14,0.4)]"
      )}
      style={
        cell.anchor
          ? { boxShadow: "inset 0 0 18px rgba(255,255,255,0.08)" }
          : undefined
      }
    >
      <span
        className={clsx(
          "flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.16em]",
          cell.anchor ? "text-white" : "text-mute"
        )}
      >
        {cell.anchor && <AnchorGlyph size={9} />}
        <span className="truncate">{cell.label}</span>
        {cell.help && <InfoTip label={cell.label} text={cell.help} />}
      </span>
      <span
        className={clsx(
          "font-mono text-[15px] font-bold leading-none tabular-nums",
          cell.anchor ? "text-white" : active ? t.value : "text-white/55"
        )}
      >
        {cell.value}
      </span>
      {cell.delta && (
        <span
          className="mt-0.5 inline-flex w-fit items-center rounded px-1 py-px font-mono text-[8px] font-bold tabular-nums"
          style={{
            color: TILE_DELTA_HEX[cell.delta.tone],
            backgroundColor: `${TILE_DELTA_HEX[cell.delta.tone]}1f`,
          }}
          title={cell.delta.note}
        >
          {cell.delta.text}
        </span>
      )}
    </div>
  );
}

function KeyLevelBox({
  cells,
  kicker,
  className,
}: {
  cells: LevelCell[];
  kicker: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-white/12 bg-[rgba(8,9,14,0.55)] px-3 py-2 backdrop-blur",
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-mute">
          Key levels
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/70">
          {kicker}
        </span>
      </div>
      {/* Tight responsive grid of small cells — 2 cols on phones, fans out to 6 at lg.
          One grouped box, much smaller footprint than the old big-card row. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((cell) => (
          <CompactLevel key={cell.key} cell={cell} />
        ))}
      </div>
    </div>
  );
}

export function GexHeatmap({
  ticker: initialTicker = "SPY",
  nativeShell = false,
}: {
  ticker?: string;
  nativeShell?: boolean;
}) {
  const [ticker, setTicker] = useState(initialTicker.toUpperCase());
  const [lens, setLens] = useState<Lens>("gex");
  // View selection ("pair-a" = Matrix (full width); "pair-b" = Profile + Curve + Shift).
  // Lifted to a controlled state (UI refactor) so the view TabList can live on the
  // top control row while its TabPanels render in the body — both share this value.
  // Tab A is now the Matrix ALONE (full content width so the far-dated monthly columns
  // breathe); the Gamma Profile moved into Tab B alongside the Curve + Shift (all three
  // are strike-axis profile views, so they group naturally).
  const [pairView, setPairView] = useState<"pair-a" | "pair-b">("pair-a");
  // Cross-tool overlay toggles (default on; auto-hidden when the overlay is null).
  const [showFlow, setShowFlow] = useState(true);
  const [showDarkPool, setShowDarkPool] = useState(true);
  // Expiry scope for the profile + curve (Rank 5). "all" = today's behavior (server
  // strike_totals); "0dte" = the nearest/earliest expiry; otherwise a specific expiry
  // string. The subset re-sums cells[strike] over the chosen expiry/expiries entirely
  // client-side (no refetch) and re-derives walls/flip from those filtered totals.
  const [expiryScope, setExpiryScope] = useState<string>("all");
  const matrixPollMs = usePollIntervalMs(5_000, 5_000);
  const quotePollMs = usePollIntervalMs(5_000, 5_000);

  // Fast-move bypass: when the live quote diverges from the cached matrix snapshot spot
  // by >0.5%, we append `&force=1` to the matrix key for ONE refetch (then clear it) so
  // the gamma/vanna profile recomputes immediately instead of waiting out the 5s cache.
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
      refreshInterval: matrixPollMs,
      refreshWhenHidden: false,
      // Refresh the moment the user returns to the tab.
      // the tab is hidden, so WITHOUT this the matrix reads up to 20s stale on return —
      // which feels like "it only updates when I refresh". Server-cached (20s) + SWR
      // deduping keep focus-triggered refetches cheap (they hit the warm cache).
      revalidateOnFocus: true,
      keepPreviousData: true,
      fallbackData: readGexHeatmapSessionCache<GexHeatmapResponse>(ticker),
      onSuccess: (payload) => {
        if (payload?.available && payload.gex?.strike_totals) {
          writeGexHeatmapSessionCache(ticker, payload);
        }
        clearForceNonce();
      },
      onError: clearForceNonce,
    }
  );

  // Live spot tape — a SEPARATE, fast (~1.5s) SWR just for the header price. Index
  // spot is true real-time WS; stocks/ETFs are shared-cached REST. The gamma
  // matrix keeps its own 5s cache above; the header quote polls at 5s.
  const { data: quote } = useSWR<QuoteResponse>(
    `/api/market/quote?ticker=${encodeURIComponent(ticker)}`,
    fetchQuote,
    { refreshInterval: quotePollMs, refreshWhenHidden: false, revalidateOnFocus: true, keepPreviousData: true }
  );

  // ── Sub-second INDEX spot via the pulse SSE (zero new REST cost) ───────────────
  // The same proven pulse stream that feeds the SPX desk header / SpxLiveStrip
  // (createPulseEventSource → /api/market/spx/pulse/stream, fed by the already-open
  // Massive indices WS) also carries the index roots below. For an INDEX ticker we
  // OVERLAY the pushed spot/change% on the header — ticking sub-second instead of the
  // ~1.5s quote SWR — while the quote SWR stays mounted as the REST backstop and as
  // the sole source for every stock/ETF (non-index) ticker. Reads a shared snapshot;
  // no rate-limiter funnel, no per-ticker REST.
  const [pulseSnap, setPulseSnap] = useState<PulseStreamSnapshot | null>(null);
  useEffect(() => {
    const conn = createPulseEventSource((snap) => setPulseSnap(snap));
    return () => conn?.close();
  }, []);

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
    if (nativeShell) setPairView("pair-a");
  }, [ticker, nativeShell]);

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

  // ── Intraday migration: GEX shift under the GEX lens, VEX shift under the VEX lens
  //    (same GexShift shape, server-computed, cached with the matrix). DEX/CHARM ship
  //    no shift → the Shift tab is hidden/disabled for them (never fabricated). ──
  const shift = lens === "gex" ? data?.shift ?? null : lens === "vex" ? data?.vex_shift ?? null : null;
  // Which lenses are actually present in THIS payload — older caches omit dex/charm/vex_shift,
  // so we hide those affordances rather than render empty (never fabricate a missing block).
  const hasDex = data?.dex != null;
  const hasCharm = data?.charm != null;
  const hasShiftForLens = (lens === "gex" && data?.shift != null) || (lens === "vex" && data?.vex_shift != null);

  // Server-computed alert events (Rank 4c) — already on the polled 20s matrix payload, no
  // extra fetch. Only trust the CURRENT ticker's events (keepPreviousData can leave a prior
  // ticker's list in hand across a switch). Empty/absent → strip renders nothing.
  const events = useMemo<GexEvent[]>(() => (stale ? [] : data?.events ?? []), [stale, data?.events]);

  // Day-over-day EOD HISTORY context — GEX-anchored (flip/walls/net-GEX). Present only once
  // ≥1 prior trading-day snapshot exists (absent on cold history, the norm until the EOD cron
  // has run a few sessions). Guarded against the stale-ticker window like events. When null,
  // every history affordance below renders nothing — the UI is exactly as today.
  const historyContext = useMemo<HistoryContext | null>(
    () => (stale ? null : data?.history_context ?? null),
    [stale, data?.history_context]
  );

  // Guard: if the active lens's block vanishes (ticker switch to an older cache, or DEX/CHARM
  // simply absent), fall back to GEX so we never sit on a lens with no data. GEX/VEX always
  // ship when a matrix exists; only DEX/CHARM can disappear, so we only need to watch those.
  useEffect(() => {
    if (data == null) return;
    if (lens === "dex" && !hasDex) setLens("gex");
    else if (lens === "charm" && !hasCharm) setLens("gex");
  }, [data, lens, hasDex, hasCharm]);

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

  // Active metric block (client-side switch — no refetch; every block is in the payload).
  // All four lenses share the SAME cells/strike_totals shape, so the profile/curve/matrix/
  // filter machinery below is block-shape-agnostic — only the levels differ (GEX/VEX carry
  // walls + flip; DEX/CHARM carry a single `zero_level` pivot in place of walls/flip).
  const block =
    lens === "gex" ? data?.gex : lens === "vex" ? data?.vex : lens === "dex" ? data?.dex : data?.charm;
  const cells = useMemo(() => block?.cells ?? {}, [block?.cells]);
  const strikeTotals = useMemo(() => block?.strike_totals ?? {}, [block?.strike_totals]);
  // Central pivot: gamma/vanna FLIP for GEX/VEX, delta-/charm-ZERO level for DEX/CHARM.
  // Both are a single strike the profile divider + curve zero-crossing render against, so
  // we unify them into one `flip` for the shared visuals.
  const flip =
    lens === "gex"
      ? data?.gex?.flip ?? null
      : lens === "vex"
        ? data?.vex?.flip ?? null
        : lens === "dex"
          ? data?.dex?.zero_level ?? null
          : data?.charm?.zero_level ?? null;
  const total = block?.total ?? 0;

  // Per-lens walls — GEX/VEX only; DEX/CHARM have NO walls (null → wall tiles/tags hide).
  const posWall = lens === "gex" ? (data?.gex?.call_wall ?? null) : lens === "vex" ? (data?.vex?.pos_wall ?? null) : null;
  const negWall = lens === "gex" ? (data?.gex?.put_wall ?? null) : lens === "vex" ? (data?.vex?.neg_wall ?? null) : null;
  // Per-lens regime posture — DEX/CHARM only; these still drive their posture cells in the
  // KEY LEVELS box. (The GEX/VEX posture pills, the regime-read blurb, and the how-to-read
  // explainer were removed in the declutter pass — those are gone, so their derived strings
  // are too.) Defensive `?.regime?.` — the engine always writes `regime` today, but an older
  // CACHED payload could lack it; non-optional `.regime` access would white-screen the component.
  const dexPosture = data?.dex?.regime?.posture ?? null;
  const charmPosture = data?.charm?.regime?.posture ?? null;

  // ── Per-expiry / 0DTE scope (Rank 5) ─────────────────────────────────────────
  // "0dte" resolves to today's date if it's on the axis, else the earliest expiry.
  const zeroDteExpiry = useMemo<string | null>(() => {
    if (expiries.length === 0) return null;
    // ET, not UTC: `toISOString().slice(0,10)` rolls to "tomorrow" after ~20:00 ET, mislabeling
    // the 0DTE chip. en-CA formats as YYYY-MM-DD, matching the expiry-axis date strings.
    const today = todayEt();
    return expiries.includes(today) ? today : expiries[0];
  }, [expiries]);

  // Far-dated standard-monthly (3rd-Friday) expiries present in the axis — the OpEx columns the
  // server now appends. Drives the "Monthly"/"Near" horizon presets + the gold far-dated chips.
  const monthlyExpiries = useMemo<string[]>(
    () => expiries.filter((e) => isMonthlyExpiry(e)),
    [expiries]
  );
  // Near-term = everything that isn't a far-dated monthly OpEx column.
  const nearExpiries = useMemo<string[]>(
    () => expiries.filter((e) => !isMonthlyExpiry(e)),
    [expiries]
  );

  // The expiries the profile + curve sum over. null ⇒ "All" (use server near-term totals).
  // "near"/"monthly" are HORIZON presets summing the near-term vs far-dated OpEx columns; a bare
  // date is a single-expiry scope. A horizon preset that resolves empty falls back to null ("All").
  const selectedExpiries = useMemo<string[] | null>(() => {
    if (expiryScope === "all") return null;
    if (expiryScope === "0dte") return zeroDteExpiry ? [zeroDteExpiry] : null;
    if (expiryScope === "near") return nearExpiries.length ? nearExpiries : null;
    if (expiryScope === "monthly") return monthlyExpiries.length ? monthlyExpiries : null;
    return [expiryScope];
  }, [expiryScope, zeroDteExpiry, nearExpiries, monthlyExpiries]);

  // Filtered per-strike totals (re-summed from cells when a subset is active; the server
  // strike_totals verbatim for "All" so it exactly matches today's behavior). These drive
  // the profile bars AND the cumulative curve. Zero refetch — both are in the payload.
  const filteredTotals = useMemo(
    () => filterStrikeTotals(cells, strikeTotals, selectedExpiries),
    [cells, strikeTotals, selectedExpiries]
  );

  // Walls + flip/zero recomputed from the FILTERED totals so the profile levels track the
  // selected scope. For "All" we keep the server-computed levels (authoritative); for a
  // subset we mirror the server's primary method client-side. DEX/CHARM have NO walls — we
  // null them so a filtered scope never synthesizes phantom call/put tags, but the central
  // pivot (zero_level) still re-derives via the same sign-crossing path.
  const filteredLevels = useMemo(() => {
    if (selectedExpiries == null) return { posWall, negWall, flip };
    const r = recomputeLevels(filteredTotals, spot);
    return isWallLens(lens) ? r : { posWall: null, negWall: null, flip: r.flip };
  }, [selectedExpiries, filteredTotals, spot, posWall, negWall, flip, lens]);
  const profilePosWall = filteredLevels.posWall;
  const profileNegWall = filteredLevels.negWall;
  const profileFlip = filteredLevels.flip;

  // ANCHOR for the PROFILE — argmax |net| over the FILTERED totals so the white marker
  // tracks the active expiry scope (it lands on the bar the profile is rendering). Null
  // when the scope is empty / all-zero. The matrix + card recompute their own anchor from
  // the data they render (all-expiry strikeTotals) so each marker matches its own view.
  const profileAnchorStrike = useMemo(
    () => anchorStrike(filteredTotals),
    [filteredTotals]
  );

  // The active block is empty when it has no strike totals (e.g. VEX skipped all IVs).
  const blockEmpty = Object.keys(strikeTotals).length === 0;
  const empty = !isLoading && data != null && (!data.available || strikes.length === 0);

  // Whether the body renders the paired views (Profile+Matrix / Curve+Shift). Mirrors
  // the success-branch gate below so the view TabList on the control row only shows when
  // there's a real block to switch between (not during load / stale / empty states).
  const showViewTabs = !((isLoading && !data) || stale) && !empty && !blockEmpty;
  const showMatrixTabs = showViewTabs && !nativeShell;

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

  const matrixLens = lens as GexHeatmapLens;
  const uwCross = data?.cross_validation;
  const uwDiverged =
    lens === "gex" &&
    uwCross?.divergence != null &&
    uwCross.divergence > 5 &&
    !(uwCross.callWallMatch && uwCross.putWallMatch && uwCross.flipMatch);

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
    if (expiryScope === "all") return "near-term";
    if (expiryScope === "0dte") return zeroDteExpiry ? `${fmtExpiry(zeroDteExpiry)} (0DTE)` : "0DTE";
    if (expiryScope === "near") return "near-term";
    if (expiryScope === "monthly") return "monthly OpEx";
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

  // ── ANCHOR for the MATRIX (and the card) ─────────────────────────────────────
  // The matrix renders the SERVER all-expiry `strikeTotals` (one row total per strike),
  // so its OVERALL anchor = argmax |strikeTotals| — the dominant net-exposure STRIKE (the
  // card uses this same all-expiry anchor so it agrees with the server-authoritative top
  // tiles). Within that anchor row we also find the single PEAK CELL: the expiry with the
  // max |cells| at the anchor strike, which gets the prominent in-cell white ◆ marker. Both
  // null-safe (empty/all-zero → null).
  const matrixAnchorStrike = useMemo(
    () => anchorStrike(strikeTotals),
    [strikeTotals]
  );
  const matrixAnchorExpiry = useMemo<string | null>(() => {
    if (matrixAnchorStrike == null) return null;
    const row = cells[String(matrixAnchorStrike)];
    if (row == null) return null;
    let bestExp: string | null = null;
    let bestMag = 0;
    // expiries order is the canonical axis — iterate it so a tie picks the earliest expiry.
    for (const e of expiries) {
      const v = row[e];
      if (typeof v !== "number") continue;
      const mag = Math.abs(v);
      if (mag > bestMag) {
        bestMag = mag;
        bestExp = e;
      }
    }
    return bestExp;
  }, [matrixAnchorStrike, cells, expiries]);

  // ── +GEX / −GEX PEAK CELLS across the WHOLE matrix (recolor: gold / bear walls) ──
  // The two DOMINANT WALLS: the single highest POSITIVE cell (the dominant call wall →
  // gold highlight) and the single lowest NEGATIVE cell (the dominant put wall → bright
  // bear #ff5c78 highlight) across every {strike, expiry} cell. These are distinct from
  // the ANCHOR (max |net| node, now white): the anchor is the largest by MAGNITUDE on the
  // row-total, while these are the largest signed CELLS. Each is { strike, expiry }; pure
  // over `cells`/`strikes`/`expiries` (no Math.random/Date) → render-safe (#418). Strikes
  // scanned ASCENDING + expiry axis iterated in order so an exact tie is deterministic
  // (lowest strike, earliest expiry). Null when no positive / no negative cell exists.
  const { posPeakCell, negPeakCell } = useMemo<{
    posPeakCell: { strike: number; expiry: string } | null;
    negPeakCell: { strike: number; expiry: string } | null;
  }>(() => {
    let pos: { strike: number; expiry: string } | null = null;
    let neg: { strike: number; expiry: string } | null = null;
    let posMax = 0; // strictly-positive running max
    let negMin = 0; // strictly-negative running min
    const strikesAsc = [...strikes].sort((a, b) => a - b);
    for (const sNum of strikesAsc) {
      const row = cells[String(sNum)];
      if (row == null) continue;
      for (const e of expiries) {
        const v = row[e];
        if (typeof v !== "number" || v === 0) continue;
        // Strict `>` / `<` keep the FIRST (lowest strike, earliest expiry) on a tie.
        if (v > posMax) {
          posMax = v;
          pos = { strike: sNum, expiry: e };
        } else if (v < negMin) {
          negMin = v;
          neg = { strike: sNum, expiry: e };
        }
      }
    }
    return { posPeakCell: pos, negPeakCell: neg };
  }, [cells, strikes, expiries]);

  // ── PER-DAY anchors across the Matrix columns (Step 4) ───────────────────────
  // For EACH expiry column, the per-day anchor = the strike with argmax|cell net GEX| in
  // that column — a SUBTLE white marker on that cell. This complements the ONE prominent
  // OVERALL anchor (max across all columns, matrixAnchorStrike/Expiry). Map keyed by expiry
  // → owning strike; null-safe (a column with no finite/non-zero cells contributes nothing).
  // Pure over `cells`/`expiries`/`strikes` (no Math.random/Date) → render-safe (#418).
  // Tie-stable: strikes are scanned ASCENDING so an exact |value| tie keeps the lowest strike,
  // matching the anchorStrike() tie-break convention. The Gamma Profile stays ONE anchor (it
  // renders a single aggregated series, not per-expiry columns) — this only affects the matrix.
  const perDayAnchorByExpiry = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    // Ascending strike order for deterministic tie-breaks (lowest strike wins a tie).
    const strikesAsc = [...strikes].sort((a, b) => a - b);
    for (const e of expiries) {
      let bestStrike: number | null = null;
      let bestMag = 0;
      for (const sNum of strikesAsc) {
        const v = cells[String(sNum)]?.[e];
        if (typeof v !== "number" || v === 0) continue;
        const mag = Math.abs(v);
        // Strict `>` keeps the first (lowest) strike on a tie.
        if (mag > bestMag) {
          bestMag = mag;
          bestStrike = sNum;
        }
      }
      if (bestStrike != null) out[e] = bestStrike;
    }
    return out;
  }, [cells, expiries, strikes]);

  // ── PER-DAY call-wall / put-wall across the Matrix columns ───────────────────
  // For EACH expiry column, its own highest POSITIVE cell (call wall) and highest
  // NEGATIVE cell (put wall) — distinct from perDayAnchorByExpiry above (that's
  // argmax|net|, i.e. whichever SIDE dominates the column; this tracks BOTH sides
  // independently). When the column's dominant value is positive, its anchor and
  // call-wall are the same strike (trivially — the largest-magnitude value can't
  // be beaten in absolute terms by a same-sign value, so it's also that side's
  // max); the OTHER side's wall, if the column has one, still gets its own
  // separate marker. This mirrors SPX Slayer's per-column columnExtremeWalls
  // (src/components/desk/SpxGexMatrixHeatmap.tsx) exactly, including the
  // ascending-strike / strict `>`/`<` tie-break convention (lowest strike wins).
  // Pure over `cells`/`expiries`/`strikes` (no Math.random/Date) → render-safe (#418).
  const perDayExtremesByExpiry = useMemo<
    Record<string, { callWall: number | null; putWall: number | null }>
  >(() => {
    const out: Record<string, { callWall: number | null; putWall: number | null }> = {};
    const strikesAsc = [...strikes].sort((a, b) => a - b);
    for (const e of expiries) {
      let callWall: number | null = null;
      let putWall: number | null = null;
      let posMax = 0;
      let negMin = 0;
      for (const sNum of strikesAsc) {
        const v = cells[String(sNum)]?.[e];
        if (typeof v !== "number" || v === 0) continue;
        if (v > posMax) {
          posMax = v;
          callWall = sNum;
        } else if (v < negMin) {
          negMin = v;
          putWall = sNum;
        }
      }
      out[e] = { callWall, putWall };
    }
    return out;
  }, [cells, expiries, strikes]);

  // ── Matrix auto-center on the SPOT row (the anchoring) ───────────────────────
  // The matrix lists strikes high→low and mounts fresh each time its tab is opened (the
  // TabPanel unmounts when inactive). Its rows live in a BOUNDED scroll box (matrixScrollRef)
  // that scrolls BOTH ways — sideways for expiry columns, vertically for strikes. A CALLBACK
  // ref on the spot <tr> fires the moment that row attaches (i.e. when the Matrix tab opens),
  // so it naturally re-centers on every tab remount without watching a key. It centers the
  // spot row WITHIN the box only — the page never moves. Double rAF waits for layout to settle
  // (sticky header + colored cells reach final heights) before measuring offsetTop. Guards
  // null/SSR so it never throws when there's no spot row (spot off-band or too few strikes).
  const matrixScrollRef = useRef<HTMLDivElement | null>(null);
  const matrixSpotRowRef = useCallback((node: HTMLTableRowElement | null) => {
    if (node == null) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const box = matrixScrollRef.current;
        if (box == null) return;
        // VERTICAL only — leave scrollLeft alone so the user's column position is kept.
        box.scrollTop = node.offsetTop - box.clientHeight / 2 + node.clientHeight / 2;
      });
    });
  }, []);

  // Profile rows: strikes desc, each carrying its FILTERED net value + role flags + flow
  // overlay. Values + wall flags follow the rank-5 expiry scope so the profile and the
  // cumulative curve (which is fed these same rows) track the selected expiry/expiries.
  const profileRows = useMemo<ProfileRow[]>(() => {
    return strikes.map((strike) => ({
      strike,
      value: filteredTotals[String(strike)] ?? 0,
      isSpot: strike === spotStrike,
      isPosWall: profilePosWall != null && strike === profilePosWall,
      isNegWall: profileNegWall != null && strike === profileNegWall,
      flow: flowByStrike?.[String(strike)] ?? null,
    }));
  }, [strikes, filteredTotals, spotStrike, profilePosWall, profileNegWall, flowByStrike]);

  const changePct = data?.change_pct ?? 0;
  const changeBull = changePct >= 0;
  const isGex = lens === "gex";
  const vocab = LENS_VOCAB[lens];
  const lensUpper = lens.toUpperCase();
  // Tailwind class for the active lens's positive identity (matches LENS_COLORS.posHex).
  const posColorClass =
    lens === "gex" ? "text-bull" : lens === "vex" ? "text-sky-300" : lens === "dex" ? "text-cyan-400" : "text-gold";
  // Panel accent per lens — constrained to the Panel's supported PanelAccent tokens
  // (no gold strip exists). GEX→bull, VEX→sky, DEX→accent (cyan), CHARM→sky. The lens's
  // true identity is carried by the tiles/bars/legends below; this is only the top strip.
  const panelAccent: "bull" | "sky" | "accent" =
    lens === "gex" ? "bull" : lens === "dex" ? "accent" : "sky";

  // ── Live header tape ─────────────────────────────────────────────────────────
  // Use the fast quote feed for the HEADER price/change; fall back to the matrix
  // snapshot (`data.spot` / `data.change_pct`) until the quote is available. The
  // gamma profile + matrix spot marker stay on the MATRIX `spot` (the gamma was
  // computed at that 20s snapshot) — only this header line goes live.
  const quoteLive = quote?.available && (quote.price ?? 0) > 0;

  // INDEX overlay: for the index roots the pulse SSE carries (SPX, VIX), prefer the
  // SUB-SECOND pushed spot over the ~1.5s quote SWR. Resolved against the SELECTED
  // ticker so a SPY/QQQ/NVDA header never picks up the SPX pulse; non-index tickers
  // fall through to the quote feed untouched. The pulse snapshot only fires when
  // `spx.price > 0` (createPulseEventSource gate), so this is push-fresh by nature.
  const pulseField: "spx" | "vix" | null = (() => {
    const t = ticker.toUpperCase().replace(/^I:/, "");
    if (t === "SPX") return "spx";
    if (t === "VIX") return "vix";
    return null;
  })();
  const pushedSpot =
    pulseField && quoteMatches ? (pulseSnap?.[pulseField]?.price ?? null) : null;
  const pushedLive = pushedSpot != null && pushedSpot > 0;
  const pushedChangePct = pulseField ? pulseSnap?.[pulseField]?.change_pct : undefined;

  const headerSpot = pushedLive
    ? (pushedSpot as number)
    : quoteLive
      ? (quote!.price as number)
      : spot;
  const headerChangePct = pushedLive
    ? (pushedChangePct ?? (quoteLive ? (quote!.change_pct ?? 0) : changePct))
    : quoteLive
      ? (quote!.change_pct ?? 0)
      : changePct;
  // NOTE: the old `headerChangeBull` + `quoteFresh` derivations powered the big central
  // spot tape (removed in the UI refactor — spot was shown 4+ times). The compact spot
  // beside the ticker selector derives its own up/down sign, and the panel's Live /
  // Quote-only badge carries the freshness signal, so neither is needed here anymore.

  // ── GEX "vs prior close" tile deltas (HISTORY context) ───────────────────────
  // Built ONLY under the GEX lens (flip/walls/net-GEX are gamma concepts — we never
  // surface stale gamma deltas under a vanna/charm header). Each chip is present only
  // when its prior value + delta both exist (never fabricated). A level rising reads
  // bull, falling reads bear, unchanged reads neutral "held"; net-GEX uses its dollar
  // sign. The shared note carries the prior-close date so the comparison is legible.
  const gexTileDeltas = useMemo(() => {
    if (lens !== "gex" || historyContext == null) return null;
    const h = historyContext;
    const priorDate = h.prior_close?.date ?? null;
    const note = priorDate ? `vs ${priorDate}` : "vs prior close";
    // Level delta → bull when higher, bear when lower, neutral when held.
    const levelDelta = (d: number | null): TileDelta | null =>
      d == null
        ? null
        : { text: fmtPtsDelta(d), tone: d > 0 ? "bull" : d < 0 ? "bear" : "neutral", note };
    const netDelta = (d: number | null): TileDelta | null =>
      d == null
        ? null
        : { text: d === 0 ? "held" : fmtMoneySigned(d), tone: d > 0 ? "bull" : d < 0 ? "bear" : "neutral", note };
    return {
      flip: levelDelta(h.flip_delta_pts),
      callWall: levelDelta(h.call_wall_delta_pts),
      putWall: levelDelta(h.put_wall_delta_pts),
      netGex: netDelta(h.net_gex_delta),
    };
  }, [lens, historyContext]);

  // Net GEX shift scalar — sum of all strike deltas in the intraday GEX shift snapshot.
  // Used as a "shift since last refresh" proxy for DEX/CHARM lenses (they have no own
  // shift data). Absent/unavailable → null → cell omitted (honesty rule, never fabricated).
  const gexShiftNet = useMemo<number | null>(() => {
    const s = data?.shift;
    if (!s?.available || !s.delta_by_strike) return null;
    const vals = Object.values(s.delta_by_strike);
    if (vals.length === 0) return null;
    return vals.reduce((acc, v) => acc + (typeof v === "number" ? v : 0), 0);
  }, [data?.shift]);

  // ── Consolidated key-level cells (Step 2) ────────────────────────────────────
  // The old ~6 big cards (flip / call wall / put wall / max pain / net / anchor) collapse
  // into ONE compact box of small label-over-value cells. Per-lens cell sets mirror the
  // prior RegimeTile sets exactly (same values, tones, help, "vs prior close" deltas):
  // GEX/VEX carry flip + two walls + max-pain + net; DEX/CHARM are zero-level + net + posture.
  // The ANCHOR cell (GEX only, when a dominant node exists) is bright-white-accented + distinct so
  // it still pops inside the grouped box — same all-expiry anchor the card used (matrixAnchorStrike).
  const levelCells = useMemo<LevelCell[]>(() => {
    if (lens === "gex") {
      const cellsOut: LevelCell[] = [
        {
          key: "flip",
          label: "Gamma Flip",
          value: flip != null ? fmtStrike(flip) : "—",
          tone: "flip",
          active: flip != null,
          help: METRIC_HELP.gammaFlip,
          delta: gexTileDeltas?.flip ?? null,
        },
        {
          key: "callWall",
          label: "Call Wall",
          value: posWall != null ? fmtStrike(posWall) : "—",
          tone: "bull",
          active: posWall != null,
          help: METRIC_HELP.callWall,
          delta: gexTileDeltas?.callWall ?? null,
        },
        {
          key: "putWall",
          label: "Put Wall",
          value: negWall != null ? fmtStrike(negWall) : "—",
          tone: "support",
          active: negWall != null,
          help: METRIC_HELP.putWall,
          delta: gexTileDeltas?.putWall ?? null,
        },
        {
          key: "maxPain",
          label: "Max Pain",
          value: maxPain != null ? fmtStrike(maxPain) : "—",
          tone: "sky",
          active: maxPain != null,
          help: METRIC_HELP.maxPain,
        },
        {
          key: "netGex",
          label: "Net GEX",
          value: fmtMoneySigned(total),
          tone: total >= 0 ? "bull" : "bear",
          help: METRIC_HELP.netGex,
          delta: gexTileDeltas?.netGex ?? null,
        },
      ];
      // ANCHOR cell — bright-white-distinct, the dominant all-expiry node (GEX only). Slots last
      // so the structural levels read left→right; the white accent makes it pop regardless.
      if (matrixAnchorStrike != null) {
        cellsOut.push({
          key: "anchor",
          label: GEX_KING_DUAL_LABEL,
          value: fmtStrike(matrixAnchorStrike),
          tone: "wall",
          anchor: true,
          help: GEX_KING_NODE_HELP,
        });
      }
      return cellsOut;
    }
    if (lens === "vex") {
      return [
        {
          key: "flip",
          label: "Vanna Flip",
          value: flip != null ? fmtStrike(flip) : "—",
          tone: "flip",
          active: flip != null,
          help: METRIC_HELP.vannaFlip,
        },
        {
          key: "posWall",
          label: "+Vanna Wall",
          value: posWall != null ? fmtStrike(posWall) : "—",
          tone: "sky",
          active: posWall != null,
          help: METRIC_HELP.posVannaWall,
        },
        {
          key: "negWall",
          label: "−Vanna Wall",
          value: negWall != null ? fmtStrike(negWall) : "—",
          tone: "wall",
          active: negWall != null,
          help: METRIC_HELP.negVannaWall,
        },
        {
          key: "maxPain",
          label: "Max Pain",
          value: maxPain != null ? fmtStrike(maxPain) : "—",
          tone: "sky",
          active: maxPain != null,
          help: METRIC_HELP.maxPain,
        },
        {
          key: "netVex",
          label: "Net VEX",
          value: fmtMoneySigned(total),
          tone: total >= 0 ? "sky" : "bear",
          help: METRIC_HELP.netVex,
        },
      ];
    }
    if (lens === "dex") {
      const cells: LevelCell[] = [
        {
          key: "zero",
          label: "Delta-Zero",
          value: flip != null ? fmtStrike(flip) : "—",
          tone: "flip",
          active: flip != null,
          help: METRIC_HELP.deltaZero,
        },
        {
          key: "netDex",
          label: "Net DEX",
          value: fmtMoneySigned(total),
          tone: total >= 0 ? "flip" : "bear",
          help: METRIC_HELP.netDex,
        },
        {
          key: "posture",
          label: "Posture",
          value: dexPosture === "long" ? "Long δ" : dexPosture === "short" ? "Short δ" : "—",
          tone: dexPosture === "long" ? "bull" : "bear",
          active: dexPosture != null,
          help: METRIC_HELP.dexPosture,
        },
      ];
      // GEX shift Δ — intraday net gamma migration since last snapshot (proxy for regime shift).
      // Absent when no GEX shift history collected yet (honesty rule — never fabricated).
      if (gexShiftNet != null) {
        cells.push({
          key: "gexShiftDelta",
          label: "GEX Shift Δ",
          value: fmtMoneySigned(gexShiftNet),
          tone: gexShiftNet >= 0 ? "bull" : "bear",
          help: "Net intraday GEX migration since the last snapshot — indicates whether dealer gamma is building (positive) or unwinding (negative) this session.",
        });
      }
      return cells;
    }
    // charm
    const charmCells: LevelCell[] = [
      {
        key: "zero",
        label: "Charm-Zero",
        value: flip != null ? fmtStrike(flip) : "—",
        tone: "wall",
        active: flip != null,
        help: METRIC_HELP.charmZero,
      },
      {
        key: "netCharm",
        label: "Net CHARM",
        value: fmtMoneySigned(total),
        tone: total >= 0 ? "wall" : "bear",
        help: METRIC_HELP.netCharm,
      },
      {
        key: "posture",
        label: "Posture",
        value: charmPosture === "positive" ? "Positive" : charmPosture === "negative" ? "Negative" : "—",
        tone: charmPosture === "positive" ? "wall" : "bear",
        active: charmPosture != null,
        help: METRIC_HELP.charmPosture,
      },
    ];
    // GEX shift Δ — same intraday proxy as DEX (charm has no own shift data).
    if (gexShiftNet != null) {
      charmCells.push({
        key: "gexShiftDelta",
        label: "GEX Shift Δ",
        value: fmtMoneySigned(gexShiftNet),
        tone: gexShiftNet >= 0 ? "bull" : "bear",
        help: "Net intraday GEX migration since the last snapshot — indicates whether dealer gamma is building (positive) or unwinding (negative) this session.",
      });
    }
    return charmCells;
  }, [
    lens,
    flip,
    posWall,
    negWall,
    maxPain,
    total,
    matrixAnchorStrike,
    gexTileDeltas,
    dexPosture,
    charmPosture,
    gexShiftNet,
  ]);

  // ── View panels (Step 3) ─────────────────────────────────────────────────────
  // The four views (Profile / Curve / Shift / Matrix) live in 2 tabs. Each view's render
  // JSX is REUSED verbatim (not rewritten) — lifted into a panel const here, then placed
  // into a grid cell below. Each panel keeps its bounded scroller, spot/flip anchoring,
  // anchor markers, diverging colors, sticky header + legends; a small header label rides
  // above each so the group reads clearly.
  // Tab A "Matrix" (default): the Strike × Expiry Matrix ALONE, FULL content width — so the
  // far-dated monthly columns breathe. Tab B "Profile + Curve + Shift": the Gamma Profile +
  // Cumulative Curve + Shift grouped (all strike-axis profile views). Scrollers stay
  // ~clamp(360px,56vh,600px); the matrix-tab box can grow taller since it owns the row.

  const profilePanel = (
    <div className="min-w-0">
      <PanelLabel>{`${vocab.noun} Profile`}</PanelLabel>
      {/* Expiry scope — All · 0DTE · per-expiry (Rank 5). Re-sums the profile
          + curve client-side over the chosen expiry/expiries. */}
      <ExpiryScopeBar
        expiries={expiries}
        zeroDteExpiry={zeroDteExpiry}
        monthlyExpiries={monthlyExpiries}
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
          {/* Overlay freshness (#9) — the dark-pool / flow-by-strike overlays ride a separate
              ~30s cache (dark-pool source up to ~2min) and can be staler than the matrix, so
              label their OWN sample time rather than letting them inherit the matrix's. */}
          {fmtAsofSeconds(data?.overlays_at ?? undefined) && (
            <span className="font-mono text-[9px] tabular-nums normal-case text-sky-300/60">
              as of {fmtAsofSeconds(data?.overlays_at ?? undefined)} ET
            </span>
          )}
        </div>
      )}
      <ExposureProfile
        rows={profileRows}
        peak={filteredPeak}
        spot={spot}
        flip={profileFlip}
        anchorStrike={profileAnchorStrike}
        lens={lens}
        showFlow={showFlow && hasFlowOverlay}
        flowPeak={flowPeak}
        darkPoolLevels={darkPoolLevels}
        showDarkPool={showDarkPool && hasDarkPoolOverlay}
        shift={shift}
      />
      <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/75">
        {`Net dealer ${vocab.unit} per strike · ${vocab.pos} / ${vocab.neg} · `}
        {scopeLabel} total{" "}
        <span className={clsx(filteredTotal >= 0 ? posColorClass : "text-bear-text")}>
          {fmtMoney(filteredTotal)}
        </span>
      </p>
    </div>
  );

  const curvePanel = (
    <div className="min-w-0">
      <PanelLabel>Cumulative Curve</PanelLabel>
      <ExpiryScopeBar
        expiries={expiries}
        zeroDteExpiry={zeroDteExpiry}
        monthlyExpiries={monthlyExpiries}
        scope={expiryScope}
        onScope={setExpiryScope}
      />
      <CumulativeCurve rows={profileRows} spot={spot} flip={profileFlip} lens={lens} />
      <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/75">
        {`Cumulative net dealer ${vocab.unit} across strikes · zero-crossing = ${vocab.pivot} · `}
        {scopeLabel} total{" "}
        <span className={clsx(filteredTotal >= 0 ? posColorClass : "text-bear-text")}>
          {fmtMoney(filteredTotal)}
        </span>
      </p>
    </div>
  );

  // Shift: intraday migration. GEX reads data.shift, VEX reads data.vex_shift (same
  // GexShift shape). The engine ships NO shift for DEX/CHARM → the panel degrades to a
  // "building history" empty state for those lenses (hasShiftForLens false) — never
  // fabricated. Curve+Shift stays a real pair under every lens; Shift self-explains.
  const shiftPanel = (
    <div className="min-w-0">
      <PanelLabel>Intraday Shift</PanelLabel>
      {hasShiftForLens && shift && shift.available ? (
        <>
          <ShiftView shift={shift} strikes={strikes} spotStrike={spotStrike} lens={lens} />
          <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/75">
            {`Δ net dealer ${vocab.unit} vs earlier snapshot · green built / red melted · pivot drift up = dealers longer`}
          </p>
        </>
      ) : (
        <EmptyState
          icon="◷"
          title="Building positioning history"
          description={
            hasShiftForLens
              ? `The shift view fills in as snapshots accumulate (first read ~after the open). ${vocab.noun} migration — where dealer ${vocab.noun.toLowerCase()} is building vs melting and how the pivot drifts — appears once enough history is collected.`
              : `Intraday migration is tracked for GEX and VEX. Switch the lens to GEX or VEX to see where dealer exposure is building vs melting and how the pivot drifts.`
          }
        />
      )}
    </div>
  );

  const matrixPanel = (
    <div className="min-w-0">
      {uwDiverged && (
        <p className="mb-2 font-mono text-[9px] leading-snug text-amber-300/90">
          UW oracle diverges {uwCross?.divergence?.toFixed(0)}pt from Polygon walls — treat levels
          as provisional until channels agree.
        </p>
      )}
      <div className="relative">
        {/* Bounded scroll box: scrolls horizontally for expiry columns AND
            vertically for strikes (the spot row is centered inside this box via
            matrixScrollRef — the page never moves). overscroll-contain stops the
            scroll chaining back to the page at the band edges; the sticky header
            row + sticky Strike column stay visible while the rows scroll. Taller now that
            Recent Ranges was removed — matrix is the primary surface on this tab. */}
        <div
          ref={matrixScrollRef}
          className="spx-gex-matrix-scroll gex-matrix-scroll max-h-[clamp(480px,74vh,880px)] min-h-[clamp(360px,58vh,640px)] overflow-auto overscroll-contain"
          role="region"
          tabIndex={0}
          aria-label={`${data?.underlying ?? ticker} dealer ${vocab.noun.toLowerCase()} exposure matrix, strikes by expiration`}
        >
          <table
            className="spx-gex-matrix-table w-max min-w-full border-collapse font-mono text-[12px] tabular-nums"
            role="grid"
            aria-label={`${data?.underlying ?? ticker} dealer ${vocab.noun.toLowerCase()} matrix by strike and expiry`}
          >
            <thead className="sticky top-0 z-20 bg-[#08080e]">
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-normal text-sky-300">
                <th className="sticky left-0 z-30 bg-[#08080e] py-1.5 pl-1 pr-2 text-left font-semibold">
                  Strike
                </th>
                {expiries.map((e) => {
                  const isMonthly = isMonthlyExpiry(e);
                  return (
                    <th
                      key={e}
                      title={isMonthly ? `${fmtHeatmapExpiry(e)} — monthly OpEx` : fmtHeatmapExpiry(e)}
                      className={clsx(
                        "py-1.5 px-0.5 text-center font-semibold whitespace-nowrap",
                        isMonthly ? "text-gold" : "text-sky-300"
                      )}
                    >
                      {fmtHeatmapExpiry(e)}
                      {isMonthly && <span aria-hidden className="ml-0.5 text-[8px] font-bold text-gold/80">M</span>}
                    </th>
                  );
                })}
                <th
                  className="py-1.5 pl-1 pr-2 text-right font-semibold whitespace-nowrap"
                  title={
                    monthlyExpiries.length > 0
                      ? "Near-term aggregate per strike (excludes monthly OpEx columns)"
                      : undefined
                  }
                >
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {strikes.map((strike) => {
                const row = cells[String(strike)] ?? {};
                const isSpot = strike === spotStrike;
                const isAnchor = matrixAnchorStrike != null && strike === matrixAnchorStrike;
                const rowTotal = strikeTotals[String(strike)] ?? 0;
                const isCallWallRow = lens === "gex" && posWall != null && strike === posWall;
                const isPutWallRow = lens === "gex" && negWall != null && strike === negWall;

                return (
                  <tr
                    key={strike}
                    ref={isSpot ? matrixSpotRowRef : undefined}
                    className={clsx(
                      "border-b border-white/[0.04]",
                      isSpot && "spx-gex-matrix-spot-row",
                      isAnchor && lens === "gex" && "spx-odte-matrix-row--anchor",
                      isCallWallRow && "spx-odte-matrix-row--max-pos",
                      isPutWallRow && "spx-odte-matrix-row--max-neg"
                    )}
                  >
                    <td
                      className={clsx(
                        "sticky left-0 z-10 bg-[#08080e] py-1 pl-1 pr-2 text-left font-bold",
                        isSpot && "text-cyan-300"
                      )}
                    >
                      {fmtHeatmapStrike(strike)}
                      {isSpot && spot > 0 && Math.abs(strike - spot) >= 0.5 && (
                        <span className="block text-[8px] font-normal text-cyan-400/80">
                          ← {fmtHeatmapStrike(spot)}
                        </span>
                      )}
                    </td>
                    {expiries.map((e) => {
                      const v = row[e];
                      const has = typeof v === "number" && Number.isFinite(v);
                      const val = has ? v : 0;
                      const isPosPeakCell =
                        posPeakCell != null && posPeakCell.strike === strike && posPeakCell.expiry === e;
                      const isNegPeakCell =
                        negPeakCell != null && negPeakCell.strike === strike && negPeakCell.expiry === e;
                      const isDayKing =
                        perDayAnchorByExpiry[e] === strike && has && v !== 0;
                      const dayExtremes = perDayExtremesByExpiry[e];
                      const isDayCallWallCell = has && dayExtremes?.callWall === strike;
                      const isDayPutWallCell = has && dayExtremes?.putWall === strike;
                      const extremeTitle = isDayCallWallCell
                        ? `Highest positive ${vocab.noun.toLowerCase()} for ${fmtHeatmapExpiry(e)}`
                        : isDayPutWallCell
                          ? `Highest negative ${vocab.noun.toLowerCase()} for ${fmtHeatmapExpiry(e)}`
                          : undefined;

                      return (
                        <td
                          key={e}
                          className={clsx(
                            "whitespace-nowrap px-0.5 py-1 text-center font-bold",
                            has && val > 0 && (lens === "gex" ? "text-emerald-300" : posColorClass),
                            has && val < 0 && (lens === "gex" ? "text-rose-300" : "text-bear-text"),
                            !has && "text-sky-300/25"
                          )}
                          style={{
                            ...(has
                              ? {
                                  ...heatmapCellStyle(val, peak, matrixLens),
                                  ...heatmapCellTextStyle(val, peak),
                                }
                              : {}),
                          }}
                          title={
                            isDayKing
                              ? `King node for ${fmtHeatmapExpiry(e)}${
                                  spot > 0 ? ` — ${Math.round(Math.abs(strike - spot))}pt from spot` : ""
                                }`
                              : extremeTitle
                          }
                        >
                          <span
                            className={clsx(
                              (isDayCallWallCell || isDayPutWallCell) && "spx-gex-matrix-extreme-pop"
                            )}
                          >
                            {fmtHeatmapMoneySigned(val, { showZero: true })}
                          </span>
                          {isDayKing && (
                            <span className="ml-0.5 inline-flex items-baseline gap-0.5">
                              <span
                                aria-hidden
                                className="text-[13px] leading-none text-amber-400 [text-shadow:0_0_6px_rgba(251,191,36,0.9)]"
                              >
                                ★
                              </span>
                              {spot > 0 && (
                                <span className="text-[7px] font-normal leading-none text-amber-300/70">
                                  {Math.round(Math.abs(strike - spot))}pt
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td
                      className={clsx(
                        "whitespace-nowrap py-1 pl-1 pr-2 text-right font-bold",
                        rowTotal > 0 && (lens === "gex" ? "text-emerald-300" : posColorClass),
                        rowTotal < 0 && (lens === "gex" ? "text-rose-300" : "text-bear-text"),
                        rowTotal === 0 && "text-sky-300/25"
                      )}
                      style={{
                        ...(rowTotal
                          ? {
                              ...heatmapCellStyle(rowTotal, totalPeak, matrixLens),
                              ...heatmapCellTextStyle(rowTotal, totalPeak),
                            }
                          : {}),
                      }}
                    >
                      {fmtHeatmapMoneySigned(rowTotal, { showZero: true })}
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

    </div>
  );

  return (
    <Panel accent={panelAccent} className={clsx("overflow-visible gex-heatmap-panel", nativeShell && "gex-heatmap-panel-native")}>
      {/* ── ONE compact control row (UI refactor) ──────────────────────────────
          [🔍 ticker + spot]  [ Profile+Matrix | Curve+Shift ]  …spacer…  [live · GEX VEX DEX CHARM]
          The old full-width ticker-chip row, the big central spot readout, and the
          separate lens box are gone — collapsed into this single row. The view tabs
          (Profile+Matrix | Curve+Shift) ride here too via a controlled mirror of the
          body's TabPanels (`pairView`); they only show once a real block is in hand.
          The redundant secondary header band (eyebrow + "<TICKER> GEX Positioning"
          title) was removed — the HEATMAPS hero + ticker selector already name the
          page. The freshness indicator that lived on that header's actions slot is
          preserved as the minimal Live/Quote-only dot at the far right of this row.
          Wraps gracefully on narrow widths (flex-wrap). */}
      <div className="relative z-[40] mb-3 flex flex-wrap items-center gap-x-4 gap-y-3 overflow-visible rounded-xl border border-white/10 bg-[rgba(8,9,14,0.45)] px-3 py-2.5 backdrop-blur gex-heatmap-control-row">
        {/* Compact searchable ticker + the ONE kept clean spot reference. */}
        <TickerSwitcher
          ticker={ticker}
          onPick={setTicker}
          spot={headerSpot}
          changePct={headerChangePct}
          showSpot={(live || quoteOnly) && headerSpot > 0}
          nativeShell={nativeShell}
        />

        {/* View tabs — Matrix | Profile + Curve + Shift. Controlled mirror of the body
            TabPanels (both driven by `pairView`). Only meaningful with a real block. */}
        {showMatrixTabs && (
          <Tabs value={pairView} onValueChange={(v) => setPairView(v as "pair-a" | "pair-b")}>
            <TabList aria-label={`${lensUpper} views`} className="max-w-full overflow-x-auto">
              <Tab value="pair-a">Matrix</Tab>
              <Tab value="pair-b">
                <span className="sm:hidden">Profile</span>
                <span className="hidden sm:inline">{`${vocab.noun} Profile + Curve + Shift`}</span>
              </Tab>
            </TabList>
          </Tabs>
        )}

        {/* Spacer pushes the freshness dot + lens toggles to the far right of the row. */}
        <span className="ml-auto" aria-hidden />

        {/* Freshness indicator — the single minimal data-freshness signal kept after the
            redundant secondary header (which carried the old Live/Quote-only badge) was
            removed. A pulsing green dot = a fresh current-ticker chain; sky = spot-only
            (chain empty); bear = offline. The fast-move flash rides here too — it fires
            when a >0.5% spot divergence forces an immediate matrix recompute. */}
        <span className="flex items-center gap-2">
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
          ) : quoteOnly ? (
            <Badge tone="sky">Quote only</Badge>
          ) : (
            <Badge tone="neutral">Offline</Badge>
          )}
        </span>

        {/* Lens switcher — FOUR lenses on the shared Tabs primitive (controlled by `lens`)
            for consistent ARIA wiring + keyboard nav (Arrow/Home/End, roving tabindex).
            `unstyled` keeps each lens's distinct on-brand color identity. DEX/CHARM tabs
            appear only when their block ships in THIS payload (older caches omit them →
            hide the tab rather than render an empty lens). Moved here (far right of the
            control row) from the old header top-right. */}
        <Tabs value={lens} onValueChange={(v) => setLens(v as Lens)}>
          <TabList
            aria-label="Exposure lens"
            unstyled
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-[rgba(8,9,14,0.5)] p-1"
          >
            {(["gex", "vex", ...(hasDex ? (["dex"] as const) : []), ...(hasCharm ? (["charm"] as const) : [])] as Lens[]).map((l) => {
              const active = l === lens;
              // Per-lens active chip: gex→bull, vex→sky, dex→cyan, charm→gold.
              const activeChip =
                l === "gex"
                  ? "bg-bull/15 text-bull outline outline-1 outline-bull/50"
                  : l === "vex"
                    ? "bg-sky-400/15 text-sky-300 outline outline-1 outline-sky-400/50"
                    : l === "dex"
                      ? "bg-cyan-400/15 text-cyan-400 outline outline-1 outline-cyan-400/50"
                      : "bg-gold/15 text-gold outline outline-1 outline-gold/50";
              return (
                <Tab
                  key={l}
                  value={l}
                  unstyled
                  className={clsx(
                    "rounded-md px-3.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-sky-400",
                    active ? activeChip : "text-sky-300/70 hover:text-white"
                  )}
                >
                  {l}
                </Tab>
              );
            })}
          </TabList>
        </Tabs>
      </div>

      {/* Key levels sit tight under the control row — matrix is the hero below. */}
      {showViewTabs && (
        <KeyLevelBox cells={levelCells} kicker={`${lensUpper} structure`} className="mb-3 gex-key-levels" />
      )}

      {/* Night Hawk active-play badge — renders only when a NH edition from the last 24h
          has a play for this ticker. Compact inline badge with a tooltip showing the play
          summary and grade. Never fabricated: driven by the server's nighthawk_context field. */}
      {data?.nighthawk_context && !stale && (
        <div
          className="mb-4 flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/[0.07] px-4 py-2.5"
          title={[
            data.nighthawk_context.summary,
            data.nighthawk_context.grade ? `Grade: ${data.nighthawk_context.grade}` : null,
          ].filter(Boolean).join(" · ")}
          style={{ boxShadow: "inset 0 0 14px rgba(34,211,238,0.06)" }}
        >
          <span className="text-cyan-400 text-sm" aria-hidden>🦅</span>
          <span className="font-mono text-[11px] font-bold text-cyan-400 uppercase tracking-widest">
            NH Play Active
          </span>
          <span className="mx-1.5 text-white/20 text-xs">·</span>
          <span className="font-mono text-[11px] text-sky-300 uppercase tracking-wide">
            {String(data.nighthawk_context.play_direction || "").toUpperCase()}
          </span>
          {data.nighthawk_context.grade && (
            <>
              <span className="mx-1.5 text-white/20 text-xs">·</span>
              <span className="font-mono text-[11px] text-cyan-400 font-bold">
                Grade {data.nighthawk_context.grade}
              </span>
            </>
          )}
          {data.nighthawk_context.summary && (
            <span className="ml-2 hidden sm:block truncate max-w-[40ch] text-[11px] text-sky-300/80 leading-none">
              {data.nighthawk_context.summary}
            </span>
          )}
        </div>
      )}

      {fetchFailed && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-xl border border-bear/40 bg-bear/[0.08] px-4 py-3"
          style={{ boxShadow: "inset 0 0 16px rgba(255,45,85,0.06)" }}
        >
          <span className="text-bear text-sm leading-none">⚠</span>
          <span className="font-mono text-[12px] font-bold text-bear tracking-wide">
            {lensUpper} feed unavailable — retrying
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
          title="No options chain"
          description={`No options chain for ${data?.underlying ?? ticker}. Pick a more liquid name or wait for the chain to print.`}
        />
      ) : blockEmpty ? (
        <EmptyState
          title={`${vocab.noun} profile idle`}
          description={
            isGex
              ? "The options chain returned no contracts right now — the snapshot is quiet outside regular trading hours. Dealer gamma prints live during the session; try another ticker if it stays idle at the open."
              : lens === "vex"
                ? "Vanna needs implied vol + time-to-expiry on the chain. No qualifying contracts right now — try GEX or another ticker."
                : lens === "dex"
                  ? "Net dealer delta needs live contracts on the chain. No qualifying open interest right now — try GEX or another ticker."
                  : "Charm needs implied vol + time-to-expiry on the chain. No qualifying contracts right now — try GEX or another ticker."
          }
        />
      ) : (
        <>
          {/* ── Positioning alerts (Rank 4c) — server-computed events riding on the polled
              20s matrix payload (ZERO extra fetch). Dismissible, reduced-motion safe;
              renders nothing when empty/absent. Sits above the regime header. ── */}
          <AlertsStrip events={events} />

          {/* ── Main area — 2 views (Step 3), restructured:
                • "Matrix" (DEFAULT) — the Strike × Expiry Matrix ALONE at FULL content width,
                  so the far-dated monthly OpEx columns breathe (no longer sharing the row with
                  the Gamma Profile).
                • "Profile + Curve + Shift" — the Gamma Profile + Cumulative Curve + Shift, all
                  strike-axis profile views grouped together. Profile takes the wide left column
                  (lg:col-span-7); Curve + Shift stack in the right column (lg:col-span-5) so
                  the curve keeps a readable width and Shift has room. Stacks on md/sm.
              The VIEW TabList lives on the top control row (controlled by `pairView`); this body
              `Tabs` is the same controlled value, so it renders ONLY the panels — no duplicate
              tab strip here. Each panel const (built above) REUSES its view's render JSX verbatim,
              keeping its bounded scroller, spot/flip anchoring, anchor markers, colors + legends.
              The GEX/VEX/DEX/CHARM lens switch drives every panel (all read the active `lens`).
              ──────────────── */}
          <Tabs value={pairView} onValueChange={(v) => setPairView(v as "pair-a" | "pair-b")} className="mt-3">
            <TabPanels>
              <TabPanel value="pair-a">{matrixPanel}</TabPanel>
              {!nativeShell ? (
                <TabPanel value="pair-b">
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                    <div className="min-w-0 lg:col-span-7">{profilePanel}</div>
                    <div className="grid min-w-0 content-start gap-5 lg:col-span-5">
                      {curvePanel}
                      {shiftPanel}
                    </div>
                  </div>
                </TabPanel>
              ) : null}
            </TabPanels>
          </Tabs>

          {/* ── Rail (full-width row below the paired views): Largo desk read · dark-pool ·
              flow summary. The redundant "KEY LEVELS" list was dropped — spot / flip / call
              wall / put wall / max pain already lead the page in the consolidated key-level
              box. ASK LARGO leads; the two small optional cards (dark-pool, flow) sit beside
              it and each self-hides when empty. ── */}
          {!nativeShell && (
            <div className="mt-5 grid gap-4 lg:grid-cols-[1.6fr_1fr] gex-heatmap-rail">
              <LargoRead key={ticker} ticker={ticker} />
              <div className="grid content-start gap-4">
                <DarkPoolRail darkPoolLevels={darkPoolLevels} />
                <FlowSummary flowByStrike={flowByStrike} overlaysLoaded={data != null} />
              </div>
            </div>
          )}

          {!nativeShell && (
          <p className="mt-5 border-t border-white/8 pt-3 text-[10px] leading-snug text-sky-300/75 gex-heatmap-methodology">
            <span aria-hidden className="mr-1 text-sky-300/70">ⓘ</span>
            Net dealer gamma uses the standard convention (dealers long calls / short
            puts); vanna is computed closed-form from implied volatility. Levels are model
            estimates from option open interest — market-structure analysis, not advice.
          </p>
          )}
        </>
      )}
    </Panel>
  );
}
