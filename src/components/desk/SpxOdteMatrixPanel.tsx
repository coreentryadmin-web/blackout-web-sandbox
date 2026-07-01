"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { Panel } from "@/components/ui";
import { AnchorGlyph } from "@/components/desk/gex-heatmap/primitives";
import { createPulseEventSource, type PulseStreamSnapshot } from "@/lib/api";
import { fmtPrice } from "@/lib/api";
import { usePollIntervalMs } from "@/hooks/use-et-market-open";

/** Client poll cadence — tuned to SPX_GEX_HEATMAP_CACHE_SEC default (8s RTH). */
const MATRIX_POLL_RTH_MS = 8_000;
const MATRIX_POLL_OFF_MS = 20_000;

type Lens = "gex" | "vex";

type MetricBlock = {
  cells: Record<string, Record<string, number>>;
  strike_totals: Record<string, number>;
  call_wall: number | null;
  put_wall: number | null;
  pos_wall?: number | null;
  neg_wall?: number | null;
  total: number;
  flip: number | null;
};

type GexHeatmapResponse = {
  available: boolean;
  underlying?: string;
  spot?: number;
  asof?: string;
  expiries?: string[];
  strikes?: number[];
  gex?: MetricBlock;
  vex?: MetricBlock;
};

type RowHighlight = "anchor" | "max-pos" | "max-neg" | null;

type MatrixRow = {
  strike: number;
  value: number;
  highlight: RowHighlight;
  isAnchor: boolean;
};

type DisplayItem =
  | { kind: "strike"; row: MatrixRow; spotOnStrike: boolean }
  | { kind: "spot"; price: number };

/** Insert a live SPOT row between bracketing strikes (desc axis), or mark on-strike. */
function buildDisplayRows(rows: MatrixRow[], spot: number, spotStrike: number | null): DisplayItem[] {
  if (!(spot > 0) || rows.length === 0) {
    return rows.map((row) => ({ kind: "strike", row, spotOnStrike: false }));
  }

  const onStrike =
    spotStrike != null && Math.abs(spot - spotStrike) < 0.05;

  if (onStrike) {
    return rows.map((row) => ({
      kind: "strike" as const,
      row,
      spotOnStrike: row.strike === spotStrike,
    }));
  }

  const out: DisplayItem[] = [];
  let spotInserted = false;
  for (const row of rows) {
    if (!spotInserted && spot > row.strike) {
      out.push({ kind: "spot", price: spot });
      spotInserted = true;
    }
    out.push({ kind: "strike", row, spotOnStrike: false });
  }
  if (!spotInserted) {
    if (spot > rows[0]!.strike) out.unshift({ kind: "spot", price: spot });
    else out.push({ kind: "spot", price: spot });
  }
  return out;
}

async function fetchGexHeatmap(url: string): Promise<GexHeatmapResponse> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`GEX heatmap → ${res.status}`);
  return res.json();
}


/** Full 0DTE column: every strike on the matrix axis, including zeros. */
function odteTotalsForAxis(
  cells: Record<string, Record<string, number>>,
  strikesAxis: number[],
  expiry: string | null
): Record<string, number> {
  if (!expiry || strikesAxis.length === 0) return {};
  const out: Record<string, number> = {};
  for (const strike of strikesAxis) {
    const v = cells[String(strike)]?.[expiry];
    out[String(strike)] = typeof v === "number" ? v : 0;
  }
  return out;
}

/** Non-zero totals only — used for anchor / wall level math. */
function nonzeroTotals(totals: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [s, v] of Object.entries(totals)) {
    if (v !== 0) out[s] = v;
  }
  return out;
}

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

function anchorStrike(totals: Record<string, number>): number | null {
  let anchor: number | null = null;
  let best = 0;
  for (const [s, v] of Object.entries(totals)) {
    const strike = Number(s);
    if (!Number.isFinite(strike)) continue;
    const mag = Math.abs(v);
    if (mag > best) {
      best = mag;
      anchor = strike;
    }
  }
  return anchor;
}

/** Compact signed dollar: +$4,770.5K / -$6,601.3K */
function fmtMoneySigned(n: number): string {
  if (n === 0) return "·";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtStrike(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function fmtExpiryHeader(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}

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

function zeroDteExpiryFrom(expiries: string[]): string | null {
  if (expiries.length === 0) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return expiries.includes(today) ? today : expiries[0];
}

function peakStrikes(totals: Record<string, number>): {
  maxPos: number | null;
  maxNeg: number | null;
} {
  let maxPos: number | null = null;
  let maxNeg: number | null = null;
  let bestPos = -Infinity;
  let bestNeg = Infinity;
  for (const [s, v] of Object.entries(totals)) {
    const strike = Number(s);
    if (!Number.isFinite(strike)) continue;
    if (v > bestPos) {
      bestPos = v;
      maxPos = strike;
    }
    if (v < bestNeg) {
      bestNeg = v;
      maxNeg = strike;
    }
  }
  if (bestPos <= 0) maxPos = null;
  if (bestNeg >= 0) maxNeg = null;
  return { maxPos, maxNeg };
}

function rowHighlightClass(highlight: RowHighlight, isAnchor: boolean): string {
  const parts: string[] = [];
  if (highlight === "max-pos") parts.push("spx-odte-matrix-row--max-pos");
  if (highlight === "max-neg") parts.push("spx-odte-matrix-row--max-neg");
  if (isAnchor) parts.push("spx-odte-matrix-row--anchor");
  return parts.join(" ");
}

type DeskProps = { live?: boolean };

export function SpxOdteMatrixPanel({ live: deskLive }: DeskProps) {
  const [lens, setLens] = useState<Lens>("gex");
  const pollMs = usePollIntervalMs(MATRIX_POLL_RTH_MS, MATRIX_POLL_OFF_MS);
  const matrixKey = "/api/market/gex-heatmap?ticker=SPX";

  const { data, isLoading, error, isValidating } = useSWR<GexHeatmapResponse>(
    matrixKey,
    fetchGexHeatmap,
    {
      refreshInterval: pollMs,
      refreshWhenHidden: false,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );

  const [pulseSnap, setPulseSnap] = useState<PulseStreamSnapshot | null>(null);
  useEffect(() => {
    const conn = createPulseEventSource((snap) => setPulseSnap(snap));
    return () => conn?.close();
  }, []);

  const expiries = data?.expiries ?? [];
  const zeroDte = useMemo(() => zeroDteExpiryFrom(expiries), [expiries]);
  const block = lens === "gex" ? data?.gex : data?.vex;
  const hasVex = Boolean(data?.vex && Object.keys(data.vex.cells ?? {}).length > 0);

  useEffect(() => {
    if (lens === "vex" && data != null && !hasVex) setLens("gex");
  }, [lens, data, hasVex]);

  const cells = block?.cells ?? {};
  const strikesAxis = useMemo(() => {
    const fromApi = (data?.strikes ?? []).filter(Number.isFinite);
    if (fromApi.length > 0) return [...fromApi].sort((a, b) => b - a);
    const fromCells = Object.keys(cells)
      .map(Number)
      .filter(Number.isFinite);
    return fromCells.sort((a, b) => b - a);
  }, [data?.strikes, cells]);

  const matrixSpot = data?.spot ?? 0;
  const pulseSpot = pulseSnap?.spx?.price ?? null;
  const spot = pulseSpot != null && pulseSpot > 0 ? pulseSpot : matrixSpot;

  const filteredTotals = useMemo(
    () => odteTotalsForAxis(cells, strikesAxis, zeroDte),
    [cells, strikesAxis, zeroDte]
  );

  const levelTotals = useMemo(() => nonzeroTotals(filteredTotals), [filteredTotals]);

  const levels = useMemo(() => recomputeLevels(levelTotals, spot), [levelTotals, spot]);
  const peaks = useMemo(() => peakStrikes(levelTotals), [levelTotals]);
  const anchor = useMemo(() => anchorStrike(levelTotals), [levelTotals]);

  const maxPosStrike = peaks.maxPos ?? levels.posWall;
  const maxNegStrike = peaks.maxNeg ?? levels.negWall;

  const spotStrike = useMemo(() => {
    const strikes = Object.keys(filteredTotals)
      .map(Number)
      .filter(Number.isFinite);
    if (!(spot > 0) || strikes.length === 0) return null;
    return strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best));
  }, [filteredTotals, spot]);

  const rows = useMemo<MatrixRow[]>(() => {
    return strikesAxis.map((strike) => {
      const isAnchor = anchor != null && strike === anchor;
      const isMaxPos = maxPosStrike != null && strike === maxPosStrike;
      const isMaxNeg = maxNegStrike != null && strike === maxNegStrike;

      let highlight: RowHighlight = null;
      if (isMaxPos) highlight = "max-pos";
      else if (isMaxNeg) highlight = "max-neg";

      return {
        strike,
        value: filteredTotals[String(strike)] ?? 0,
        highlight,
        isAnchor,
      };
    });
  }, [strikesAxis, filteredTotals, maxPosStrike, maxNegStrike, anchor]);

  const displayRows = useMemo(
    () => buildDisplayRows(rows, spot, spotStrike),
    [rows, spot, spotStrike]
  );

  const scrollSpotKey = useMemo(() => {
    if (!(spot > 0)) return null;
    if (spotStrike != null && Math.abs(spot - spotStrike) < 0.05) return `strike-${spotStrike}`;
    return `spot-${spot.toFixed(2)}`;
  }, [spot, spotStrike]);

  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (scrollSpotKey == null) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const box = scrollBoxRef.current;
        const row = spotRowRef.current;
        if (box == null || row == null) return;
        box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [scrollSpotKey]);

  const hasData = Boolean(data?.available) && strikesAxis.length > 0;
  const feedLive = Boolean(deskLive) && hasData && !error;
  const asofLabel = fmtAsofSeconds(data?.asof);
  const expiryHeader = zeroDte ? fmtExpiryHeader(zeroDte) : "0DTE";

  const netTotal = useMemo(
    () => Object.values(filteredTotals).reduce((s, v) => s + v, 0),
    [filteredTotals]
  );

  const pivotLabel = lens === "gex" ? "γ flip" : "vanna flip";
  const lensLabel = lens === "gex" ? "GEX" : "VEX";
  const panelAccent = lens === "gex" ? "bull" : "sky";

  return (
    <Panel
      accent={panelAccent}
      kicker={zeroDte ? `0DTE · ${zeroDte} · ${lensLabel}` : `0DTE · ${lensLabel}`}
      title="SPX structure"
      actions={
        <span className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-white/70">
          {isValidating && !isLoading && (
            <span className="text-white/50" aria-live="polite">
              ↻
            </span>
          )}
          <span
            className={clsx("badge-live-dot", feedLive ? "animate-pulse" : "opacity-40")}
            aria-hidden
          />
          {asofLabel ? <span>as of {asofLabel} ET</span> : null}
        </span>
      }
      className="spx-odte-matrix-panel flex flex-1 min-h-0 flex-col"
      bodyClassName="spx-odte-matrix-body !px-2 !py-3 flex flex-1 min-h-0 flex-col"
    >
      <div className="spx-odte-matrix-controls mb-3 shrink-0 space-y-2">
        <div className="flex gap-1.5" role="tablist" aria-label="Exposure lens">
          {(["gex", "vex"] as const).map((key) => {
            const active = lens === key;
            const disabled = key === "vex" && !hasVex && !isLoading;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => setLens(key)}
                className={clsx(
                  "spx-odte-lens-toggle flex-1 rounded border px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] transition-colors",
                  active && key === "gex" && "spx-odte-lens-toggle--gex-active",
                  active && key === "vex" && "spx-odte-lens-toggle--vex-active",
                  !active && "spx-odte-lens-toggle--idle",
                  disabled && "opacity-40 cursor-not-allowed"
                )}
              >
                {key === "gex" ? "GEX" : "VEX"}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
          <div>
            <span className="text-white/50 uppercase tracking-wider">{pivotLabel}</span>
            <div className="text-sm font-bold tabular-nums text-white">
              {levels.flip != null ? fmtStrike(levels.flip) : "—"}
            </div>
          </div>
          <div>
            <span className="text-white/50 uppercase tracking-wider">Net {lensLabel}</span>
            <div className="text-sm font-bold tabular-nums text-white">
              {hasData ? fmtMoneySigned(netTotal) : "—"}
            </div>
          </div>
        </div>
      </div>

      {isLoading && !data ? (
        <p className="font-mono text-[11px] text-white/60 py-4">Loading 0DTE matrix…</p>
      ) : error && !hasData ? (
        <p className="font-mono text-[11px] text-white/60 py-4">Matrix unavailable — retrying…</p>
      ) : !hasData ? (
        <p className="font-mono text-[11px] text-white/60 py-4">Mapping 0DTE gamma nodes…</p>
      ) : (
        <div
          ref={scrollBoxRef}
          className="spx-odte-matrix-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain"
          aria-label={`SPX 0DTE net dealer ${lensLabel} by strike`}
        >
          <table className="spx-odte-matrix-table w-full border-collapse font-mono text-[12px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-[#08080e]">
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/55">
                <th className="py-2 pl-1 pr-2 text-left font-semibold">Strike</th>
                <th className="py-2 px-2 text-right font-semibold">
                  {expiryHeader}
                  <span className="ml-1 text-[9px] normal-case tracking-normal text-white/40">
                    {lensLabel}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((item) => {
                if (item.kind === "spot") {
                  return (
                    <tr
                      key={`spot-${item.price.toFixed(2)}`}
                      ref={spotRowRef}
                      className="spx-odte-matrix-spot-row spx-odte-matrix-spot-blink"
                      aria-label={`Live spot ${fmtPrice(item.price)}`}
                    >
                      <td colSpan={2} className="spx-odte-matrix-spot-cell py-1.5 px-2">
                        <span className="flex items-center justify-between gap-2 font-bold text-cyan-300">
                          <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-400/90">
                            ◂ spot ▸
                          </span>
                          <span className="text-[13px] tabular-nums text-white spx-odte-matrix-live-spot">
                            {fmtPrice(item.price)}
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                }

                const r = item.row;
                const hlClass = rowHighlightClass(r.highlight, r.isAnchor);

                return (
                  <tr
                    key={r.strike}
                    ref={item.spotOnStrike ? spotRowRef : undefined}
                    className={clsx(
                      "spx-odte-matrix-row border-b border-white/[0.04]",
                      hlClass,
                      item.spotOnStrike && "spx-odte-matrix-row--spot-on-strike spx-odte-matrix-spot-blink"
                    )}
                  >
                    <td className="spx-odte-matrix-strike py-1 pl-1 pr-2 text-left">
                      {fmtStrike(r.strike)}
                      {item.spotOnStrike && (
                        <span className="ml-1 text-[9px] uppercase tracking-wider text-cyan-400">
                          spot
                        </span>
                      )}
                    </td>
                    <td className="spx-odte-matrix-value relative py-1 px-2 text-right">
                      {r.value !== 0 ? fmtMoneySigned(r.value) : "·"}
                      {r.isAnchor && (
                        <span className="ml-1 inline-flex align-middle" title="Anchor — max |GEX|">
                          <AnchorGlyph size={10} className="text-white" />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 shrink-0 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] tracking-wide text-white/45">
        <span className="inline-flex items-center gap-1">
          <AnchorGlyph size={8} className="text-white" /> Anchor
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-[#00e676]/90" aria-hidden /> Max +
          {lensLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-[#6d28d9]/80" aria-hidden /> Max −
          {lensLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-cyan-400/90 spx-odte-matrix-spot-blink" aria-hidden /> Live spot
        </span>
        <span className="text-white/35">
          · {rows.length} strikes · refresh {Math.round(pollMs / 1000)}s
        </span>
      </div>
    </Panel>
  );
}
