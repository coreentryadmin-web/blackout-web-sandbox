"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { Panel } from "@/components/ui";
import { AnchorGlyph } from "@/components/desk/gex-heatmap/primitives";
import { createPulseEventSource, type PulseStreamSnapshot } from "@/lib/api";
import { fmtPrice } from "@/lib/api";
import { usePollIntervalMs } from "@/hooks/use-et-market-open";

/** Client poll cadence for the left-rail 0DTE matrix (RTH vs off-hours). */
const MATRIX_POLL_RTH_MS = 12_000;
const MATRIX_POLL_OFF_MS = 30_000;

type GexBlock = {
  cells: Record<string, Record<string, number>>;
  strike_totals: Record<string, number>;
  call_wall: number | null;
  put_wall: number | null;
  total: number;
  flip: number | null;
};

type GexHeatmapResponse = {
  available: boolean;
  underlying?: string;
  spot?: number;
  asof?: string;
  expiries?: string[];
  gex?: GexBlock;
};

type RowHighlight = "anchor" | "max-pos" | "max-neg" | null;

type MatrixRow = {
  strike: number;
  value: number;
  highlight: RowHighlight;
  isAnchor: boolean;
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

function rowHighlightClass(highlight: RowHighlight, isAnchor: boolean): string {
  if (highlight === "max-pos") return "spx-odte-matrix-row--max-pos";
  if (highlight === "max-neg") return "spx-odte-matrix-row--max-neg";
  if (isAnchor) return "spx-odte-matrix-row--anchor";
  return "";
}

type DeskProps = { live?: boolean };

export function SpxOdteMatrixPanel({ live: deskLive }: DeskProps) {
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
  const cells = data?.gex?.cells ?? {};
  const strikeTotals = data?.gex?.strike_totals ?? {};
  const matrixSpot = data?.spot ?? 0;
  const pulseSpot = pulseSnap?.spx?.price ?? null;
  const spot = pulseSpot != null && pulseSpot > 0 ? pulseSpot : matrixSpot;

  const filteredTotals = useMemo(
    () => filterStrikeTotals(cells, strikeTotals, zeroDte ? [zeroDte] : null),
    [cells, strikeTotals, zeroDte]
  );

  const levels = useMemo(() => recomputeLevels(filteredTotals, spot), [filteredTotals, spot]);
  const anchor = useMemo(() => anchorStrike(filteredTotals), [filteredTotals]);

  const spotStrike = useMemo(() => {
    const strikes = Object.keys(filteredTotals)
      .map(Number)
      .filter(Number.isFinite);
    if (!(spot > 0) || strikes.length === 0) return null;
    return strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best));
  }, [filteredTotals, spot]);

  const rows = useMemo<MatrixRow[]>(() => {
    const strikes = Object.keys(filteredTotals)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);

    const band =
      spotStrike != null
        ? strikes.filter((s) => Math.abs(s - spotStrike) <= 30)
        : strikes.slice(0, 40);

    return band.map((strike) => {
      const isAnchor = anchor != null && strike === anchor;
      const isMaxPos = levels.posWall != null && strike === levels.posWall;
      const isMaxNeg = levels.negWall != null && strike === levels.negWall;

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
  }, [filteredTotals, spotStrike, levels.posWall, levels.negWall, anchor]);

  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (spotStrike == null) return;
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
  }, [spotStrike]);

  const hasData = Boolean(data?.available) && rows.length > 0;
  const feedLive = Boolean(deskLive) && hasData && !error;
  const asofLabel = fmtAsofSeconds(data?.asof);
  const expiryHeader = zeroDte ? fmtExpiryHeader(zeroDte) : "0DTE";

  return (
    <Panel
      accent="bull"
      kicker={zeroDte ? `0DTE · ${zeroDte}` : "0DTE gamma matrix"}
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
      <div className="spx-odte-matrix-levels mb-3 shrink-0 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[10px]">
        <div>
          <span className="text-white/50 uppercase tracking-wider">Spot</span>
          <div className="text-sm font-semibold tabular-nums text-white">
            {spot > 0 ? fmtPrice(spot) : "—"}
          </div>
        </div>
        <div>
          <span className="text-white/50 uppercase tracking-wider">γ flip</span>
          <div className="text-sm tabular-nums text-white">
            {levels.flip != null ? fmtStrike(levels.flip) : "—"}
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
          aria-label="SPX 0DTE net dealer gamma by strike"
        >
          <table className="spx-odte-matrix-table w-full border-collapse font-mono text-[11px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-[#08080e]">
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/55">
                <th className="py-2 pl-1 pr-2 text-left font-semibold">Strike</th>
                <th className="py-2 px-2 text-right font-semibold">{expiryHeader}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSpot = spotStrike != null && r.strike === spotStrike;
                const hlClass = rowHighlightClass(r.highlight, r.isAnchor);

                return (
                  <tr
                    key={r.strike}
                    ref={isSpot ? spotRowRef : undefined}
                    className={clsx(
                      "spx-odte-matrix-row border-b border-white/[0.04]",
                      hlClass,
                      r.isAnchor && r.highlight != null && "spx-odte-matrix-row--anchor-on-peak"
                    )}
                  >
                    <td className="py-1.5 pl-1 pr-2 text-left text-white/90">
                      {fmtStrike(r.strike)}
                      {isSpot && (
                        <span className="ml-1 text-[8px] text-white/45" title="Nearest spot">
                          ●
                        </span>
                      )}
                    </td>
                    <td className="relative py-1.5 px-2 text-right font-semibold text-white">
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
          <span className="inline-block h-2 w-3 rounded-sm bg-[#ffd23f]/80" aria-hidden /> Max +GEX
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-[#6d28d9]/80" aria-hidden /> Max −GEX
        </span>
        <span className="text-white/35">· refresh {Math.round(pollMs / 1000)}s</span>
      </div>
    </Panel>
  );
}
