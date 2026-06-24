"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import {
  Panel,
  Badge,
  Stat,
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
  overlays?: Overlays;
  error?: string;
};

type TickerSearchResult = { ticker: string; name: string; type?: string };

async function fetchGexHeatmap(url: string): Promise<GexHeatmapResponse> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`GEX heatmap → ${res.status}`);
  return res.json();
}

/** Compact signed dollar value: $22.1K / -$45.2M. */
function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs < 1) return "·";
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
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
                  "w-20 shrink-0 text-right font-mono text-[10px] tabular-nums",
                  positive ? (lens === "gex" ? "text-bull" : "text-sky-300") : "text-purple-light"
                )}
              >
                {fmtMoney(r.value)}
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
        <span className="text-sky-300">
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

export function GexHeatmap({ ticker: initialTicker = "SPY" }: { ticker?: string }) {
  const [ticker, setTicker] = useState(initialTicker.toUpperCase());
  const [lens, setLens] = useState<Lens>("gex");
  // Cross-tool overlay toggles (default on; auto-hidden when the overlay is null).
  const [showFlow, setShowFlow] = useState(true);
  const [showDarkPool, setShowDarkPool] = useState(true);

  const { data, isLoading, error } = useSWR<GexHeatmapResponse>(
    `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`,
    fetchGexHeatmap,
    { refreshInterval: 45_000, revalidateOnFocus: false, keepPreviousData: true }
  );

  const live = !error && Boolean(data?.available);
  const fetchFailed = Boolean(error) && !isLoading;

  const spot = data?.spot ?? 0;
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

  return (
    <Panel
      accent={isGex ? "bull" : "sky"}
      kicker={isGex ? "Dealer gamma exposure · Polygon options" : "Dealer vanna exposure · Polygon options"}
      title={
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span>
            {data?.underlying ?? ticker} {isGex ? "GEX" : "VEX"} Positioning
          </span>
          {live && spot > 0 && (
            <>
              <span className="font-mono text-sm font-semibold text-white">
                {spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={clsx("font-mono text-xs font-bold", changeBull ? "text-bull" : "text-bear")}>
                {fmtPct(changePct)}
              </span>
            </>
          )}
        </span>
      }
      actions={
        live ? (
          <Badge tone="bull" dot>
            Live
          </Badge>
        ) : (
          <Badge tone="neutral">Offline</Badge>
        )
      }
    >
      {/* ── Controls: ticker switcher + GEX|VEX lens toggle ─────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TickerSwitcher ticker={ticker} onPick={setTicker} />
        <div
          role="tablist"
          aria-label="Exposure lens"
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-[rgba(8,9,14,0.4)] p-1"
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
                  "rounded-md px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider outline-none transition-colors",
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
        <div className="space-y-4" aria-hidden>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={80} rounded="xl" />
            ))}
          </div>
          <Skeleton height={20} rounded="lg" />
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} height={22} rounded="md" />
          ))}
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
              ? "The dealer gamma profile prints from the live options chain during RTH. Standby until the bell."
              : "Vanna needs implied vol + time-to-expiry on the chain. No qualifying contracts right now — try GEX or another ticker."
          }
        />
      ) : (
        <>
          {/* ── Regime header ──────────────────────────────────────────── */}
          {isGex ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Gamma Flip"
                value={flip != null ? fmtStrike(flip) : "—"}
                tone={flip != null ? "accent" : "neutral"}
                sublabel="Posture pivot"
                compact
              />
              <Stat
                label="Call Wall"
                value={posWall != null ? fmtStrike(posWall) : "—"}
                tone="bull"
                sublabel="Resistance / pin"
                compact
              />
              <Stat
                label="Put Wall"
                value={negWall != null ? fmtStrike(negWall) : "—"}
                tone="bear"
                sublabel="Support"
                compact
              />
              <Stat
                label="Max Pain"
                value={maxPain != null ? fmtStrike(maxPain) : "—"}
                tone="sky"
                sublabel="OI value floor"
                compact
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Vanna Flip"
                value={flip != null ? fmtStrike(flip) : "—"}
                tone={flip != null ? "accent" : "neutral"}
                sublabel="Sign pivot"
                compact
              />
              <Stat
                label="+Vanna Wall"
                value={posWall != null ? fmtStrike(posWall) : "—"}
                tone="sky"
                sublabel="Adds to moves"
                compact
              />
              <Stat
                label="−Vanna Wall"
                value={negWall != null ? fmtStrike(negWall) : "—"}
                tone="accent"
                sublabel="Fades moves"
                compact
              />
              <Stat
                label="Net Vanna"
                value={fmtMoney(total)}
                tone={total >= 0 ? "sky" : "accent"}
                sublabel="$-vanna total"
                compact
              />
            </div>
          )}

          {/* regime one-liner + posture badge */}
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

          {/* ── Profile | Matrix toggle ───────────────────────────────── */}
          <Tabs defaultValue="profile">
            <TabList aria-label={`${isGex ? "GEX" : "VEX"} view`} className="mt-4 w-fit">
              <Tab value="profile">{isGex ? "Gamma Profile" : "Vanna Profile"}</Tab>
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
        </>
      )}
    </Panel>
  );
}
