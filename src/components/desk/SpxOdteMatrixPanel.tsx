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

type MatrixRow = {
  strike: number;
  value: number;
  isSpot: boolean;
  isPosWall: boolean;
  isNegWall: boolean;
  isFlip: boolean;
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
  const entries = Object.entries(totals)
    .map(([s, v]) => ({ strike: Number(s), value: v }))
    .filter((e) => Number.isFinite(e.strike))
    .sort((a, b) => a.strike - b.strike);
  for (const e of entries) {
    const mag = Math.abs(e.value);
    if (mag > best) {
      best = mag;
      anchor = e.strike;
    }
  }
  return anchor;
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs < 1) return "·";
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtStrike(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
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

function barStyle(value: number, peak: number): React.CSSProperties {
  if (!value || peak <= 0) return {};
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = 0.04 + Math.pow(mag, 1.35) * 0.88;
  const rgb = value > 0 ? "0,230,118" : "255,45,85";
  return {
    backgroundColor: `rgba(${rgb},${alpha.toFixed(3)})`,
    boxShadow: mag > 0.45 ? `inset 0 0 18px rgba(${rgb},${(mag * 0.4).toFixed(2)})` : undefined,
  };
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

  const peak = useMemo(() => {
    let p = 0;
    for (const v of Object.values(filteredTotals)) {
      const a = Math.abs(v);
      if (a > p) p = a;
    }
    return p;
  }, [filteredTotals]);

  const spotStrike = useMemo(() => {
    const strikes = Object.keys(filteredTotals)
      .map(Number)
      .filter(Number.isFinite);
    if (!(spot > 0) || strikes.length === 0) return null;
    return strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best));
  }, [filteredTotals, spot]);

  const flipStrike = useMemo(() => {
    if (levels.flip == null) return null;
    const strikes = Object.keys(filteredTotals)
      .map(Number)
      .filter(Number.isFinite);
    if (strikes.length === 0) return null;
    return strikes.reduce((best, s) =>
      Math.abs(s - levels.flip!) < Math.abs(best - levels.flip!) ? s : best
    );
  }, [filteredTotals, levels.flip]);

  const rows = useMemo<MatrixRow[]>(() => {
    const strikes = Object.keys(filteredTotals)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);

    const band =
      spotStrike != null
        ? strikes.filter((s) => Math.abs(s - spotStrike) <= 30)
        : strikes.slice(0, 40);

    return band.map((strike) => ({
      strike,
      value: filteredTotals[String(strike)] ?? 0,
      isSpot: spotStrike != null && strike === spotStrike,
      isPosWall: levels.posWall != null && strike === levels.posWall,
      isNegWall: levels.negWall != null && strike === levels.negWall,
      isFlip: flipStrike != null && strike === flipStrike,
      isAnchor: anchor != null && strike === anchor,
    }));
  }, [filteredTotals, spotStrike, levels.posWall, levels.negWall, flipStrike, anchor]);

  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLDivElement | null>(null);
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
  const netTotal = useMemo(
    () => Object.values(filteredTotals).reduce((s, v) => s + v, 0),
    [filteredTotals]
  );

  return (
    <Panel
      accent="bull"
      kicker={zeroDte ? `0DTE · ${zeroDte}` : "0DTE gamma matrix"}
      title="SPX structure"
      actions={
        <span className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-sky-300/80">
          {isValidating && !isLoading && (
            <span className="text-cyan-400/70" aria-live="polite">
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
      bodyClassName="spx-odte-matrix-body !px-3 !py-3 flex flex-1 min-h-0 flex-col"
    >
      <div className="spx-odte-matrix-levels mb-3 shrink-0 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[10px]">
        <div>
          <span className="text-cyan-400/80 uppercase tracking-wider">Spot</span>
          <div className="text-sm font-semibold tabular-nums text-white">
            {spot > 0 ? fmtPrice(spot) : "—"}
          </div>
        </div>
        <div>
          <span className="text-gold/80 uppercase tracking-wider">Net GEX</span>
          <div
            className={clsx(
              "text-sm font-semibold tabular-nums",
              netTotal >= 0 ? "num-bull" : "num-bear"
            )}
          >
            {hasData ? fmtMoney(netTotal) : "—"}
          </div>
        </div>
        <div>
          <span className="text-gold/80 uppercase tracking-wider">γ flip</span>
          <div className="text-sm tabular-nums text-gold">
            {levels.flip != null ? fmtStrike(levels.flip) : "—"}
          </div>
        </div>
        <div>
          <span className="text-cyan-400/80 uppercase tracking-wider">Walls</span>
          <div className="text-[11px] tabular-nums">
            <span className="num-bull">{levels.posWall != null ? fmtStrike(levels.posWall) : "—"}</span>
            <span className="text-cyan-400/50 mx-1">/</span>
            <span className="num-bear">{levels.negWall != null ? fmtStrike(levels.negWall) : "—"}</span>
          </div>
        </div>
      </div>

      {isLoading && !data ? (
        <p className="font-mono text-[11px] text-cyan-400 py-4">Loading 0DTE matrix…</p>
      ) : error && !hasData ? (
        <p className="font-mono text-[11px] text-bear py-4">Matrix unavailable — retrying…</p>
      ) : !hasData ? (
        <p className="font-mono text-[11px] text-cyan-400 py-4">Mapping 0DTE gamma nodes…</p>
      ) : (
        <div
          ref={scrollBoxRef}
          className="spx-odte-matrix-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-px pr-1"
          aria-label="SPX 0DTE net dealer gamma by strike"
        >
          {rows.map((r) => {
            const mag = peak > 0 ? Math.min(1, Math.abs(r.value) / peak) : 0;
            const widthPct = (r.value !== 0 ? Math.max(3, Math.pow(mag, 0.82) * 50) : 0).toFixed(2);
            const positive = r.value > 0;
            const barColor = positive ? "#00e676" : "#ff2d55";

            return (
              <div
                key={r.strike}
                ref={r.isSpot ? spotRowRef : undefined}
                className={clsx(
                  "spx-odte-matrix-row grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-2 rounded px-1 py-0.5",
                  r.isSpot && "outline outline-1 outline-cyan-400/60 bg-cyan-400/[0.06]",
                  r.isFlip && !r.isSpot && "bg-gold/[0.06]"
                )}
                style={barStyle(r.value, peak)}
              >
                <span
                  className={clsx(
                    "font-mono text-[11px] tabular-nums",
                    r.isSpot ? "font-bold text-white" : "text-sky-200"
                  )}
                >
                  {fmtStrike(r.strike)}
                  {r.isAnchor && (
                    <AnchorGlyph size={9} className="ml-0.5 inline text-white/90" />
                  )}
                </span>

                <div className="relative h-4 rounded-sm bg-black/40 overflow-hidden">
                  <div
                    className="absolute top-0 bottom-0 left-1/2 w-px bg-white/15"
                    aria-hidden
                  />
                  {r.value !== 0 && (
                    <div
                      className="absolute top-0.5 bottom-0.5 rounded-sm"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: barColor,
                        opacity: 0.85,
                        ...(positive
                          ? { left: "50%" }
                          : { right: "50%" }),
                      }}
                    />
                  )}
                </div>

                <span
                  className={clsx(
                    "font-mono text-[10px] tabular-nums text-right",
                    positive ? "num-bull" : r.value < 0 ? "num-bear" : "text-cyan-400"
                  )}
                >
                  {r.value !== 0 ? fmtMoney(r.value) : "·"}
                  {r.isPosWall && <span className="ml-1 text-[8px] text-bull">CW</span>}
                  {r.isNegWall && <span className="ml-1 text-[8px] text-bear">PW</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2 shrink-0 font-mono text-[9px] tracking-wide text-cyan-400/60">
        Auto-refresh every {Math.round(pollMs / 1000)}s · 0DTE net dealer $-gamma
      </p>
    </Panel>
  );
}
