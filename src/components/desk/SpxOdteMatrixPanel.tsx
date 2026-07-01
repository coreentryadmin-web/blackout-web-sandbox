"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { Panel } from "@/components/ui";
import { fmtPrice } from "@/lib/api";
import { usePollIntervalMs } from "@/hooks/use-et-market-open";
import {
  columnTotalsForAxis,
  computeZeroGammaFlip,
  kingFromStrikeTotals,
  odteStrikeTotalsFromCells,
  recomputeScopedGexLevels,
  resolveOdteExpiry,
  resolveZeroDteExpiry,
} from "@/lib/correctness/gex-odte-scope";
import { todayEtYmd } from "@/lib/providers/spx-session";

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

/** Readable tags in the label column between strike and GEX/VEX value. */
type RowLabel = "Anchor" | "Max +" | "Max −" | "Spot" | "R1" | "R2" | "S1" | "S2";

type MatrixRow = {
  strike: number;
  value: number;
  highlight: RowHighlight;
  labels: RowLabel[];
  spotOnStrike: boolean;
};

type OverlayLevel = {
  price: number;
  label: RowLabel;
  tone: "spot" | "resistance" | "support";
};

type DisplayItem =
  | { kind: "strike"; row: MatrixRow }
  | { kind: "level"; price: number; labels: RowLabel[]; tone: OverlayLevel["tone"] };

const LEVEL_ON_STRIKE_EPS = 0.05;

/** Classic floor pivots from prior session H / L / C. */
function floorPivots(
  high: number | null | undefined,
  low: number | null | undefined,
  close: number | null | undefined
): { r1: number; r2: number; s1: number; s2: number } | null {
  if (high == null || low == null || close == null) return null;
  if (!(high > 0 && low > 0 && close > 0 && high >= low)) return null;
  const pivot = (high + low + close) / 3;
  return {
    r1: 2 * pivot - low,
    r2: pivot + (high - low),
    s1: 2 * pivot - high,
    s2: pivot - (high - low),
  };
}

function overlaysFromPivots(
  spot: number,
  pivots: ReturnType<typeof floorPivots>
): OverlayLevel[] {
  const out: OverlayLevel[] = [];
  if (spot > 0) out.push({ price: spot, label: "Spot", tone: "spot" });
  if (pivots == null) return out;
  out.push(
    { price: pivots.r2, label: "R2", tone: "resistance" },
    { price: pivots.r1, label: "R1", tone: "resistance" },
    { price: pivots.s1, label: "S1", tone: "support" },
    { price: pivots.s2, label: "S2", tone: "support" }
  );
  return out;
}

/** Merge overlay levels into strike rows or insert between strikes (desc axis). */
function buildDisplayRows(rows: MatrixRow[], overlays: OverlayLevel[]): DisplayItem[] {
  if (rows.length === 0) return [];

  const unmatched: OverlayLevel[] = [];
  const labelsByStrike = new Map<number, RowLabel[]>();
  const spotOnStrike = new Set<number>();

  for (const overlay of overlays) {
    if (!(overlay.price > 0)) continue;
    let matched = false;
    for (const row of rows) {
      if (Math.abs(overlay.price - row.strike) < LEVEL_ON_STRIKE_EPS) {
        const existing = labelsByStrike.get(row.strike) ?? [];
        if (!existing.includes(overlay.label)) existing.push(overlay.label);
        labelsByStrike.set(row.strike, existing);
        if (overlay.label === "Spot") spotOnStrike.add(row.strike);
        matched = true;
        break;
      }
    }
    if (!matched) unmatched.push(overlay);
  }

  const enrichedRows = rows.map((row) => {
    const extra = labelsByStrike.get(row.strike) ?? [];
    const labels = [...row.labels];
    for (const label of extra) {
      if (!labels.includes(label)) labels.push(label);
    }
    return {
      ...row,
      labels,
      spotOnStrike: row.spotOnStrike || spotOnStrike.has(row.strike),
    };
  });

  unmatched.sort((a, b) => b.price - a.price);

  const out: DisplayItem[] = [];
  let overlayIdx = 0;
  for (const row of enrichedRows) {
    while (overlayIdx < unmatched.length && unmatched[overlayIdx]!.price > row.strike) {
      const o = unmatched[overlayIdx]!;
      out.push({ kind: "level", price: o.price, labels: [o.label], tone: o.tone });
      overlayIdx++;
    }
    out.push({ kind: "strike", row });
  }
  while (overlayIdx < unmatched.length) {
    const o = unmatched[overlayIdx]!;
    out.push({ kind: "level", price: o.price, labels: [o.label], tone: o.tone });
    overlayIdx++;
  }
  return out;
}

function labelCellClass(label: RowLabel): string {
  if (label === "Spot") return "spx-odte-matrix-label--spot";
  if (label === "R1" || label === "R2") return "spx-odte-matrix-label--resistance";
  if (label === "S1" || label === "S2") return "spx-odte-matrix-label--support";
  if (label === "Max +") return "spx-odte-matrix-label--max-pos";
  if (label === "Max −") return "spx-odte-matrix-label--max-neg";
  return "spx-odte-matrix-label--anchor";
}

function MatrixLabels({ labels }: { labels: RowLabel[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="spx-odte-matrix-labels inline-flex flex-wrap justify-center gap-x-1 gap-y-0.5">
      {labels.map((label) => (
        <span key={label} className={clsx("spx-odte-matrix-label", labelCellClass(label))}>
          {label}
        </span>
      ))}
    </span>
  );
}

const FLOOR_PIVOT_REFS: Array<{
  key: keyof NonNullable<ReturnType<typeof floorPivots>>;
  label: RowLabel;
  tone: "resistance" | "support";
}> = [
  { key: "r2", label: "R2", tone: "resistance" },
  { key: "r1", label: "R1", tone: "resistance" },
  { key: "s1", label: "S1", tone: "support" },
  { key: "s2", label: "S2", tone: "support" },
];

function mergeAxisWithPivots(
  strikes: number[],
  pivots: ReturnType<typeof floorPivots>
): number[] {
  if (pivots == null) return strikes;
  const extras = FLOOR_PIVOT_REFS.map(({ key }) => pivots[key]).filter((n) => n > 0);
  return [...new Set([...strikes, ...extras])].sort((a, b) => b - a);
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

function rowHighlightClass(highlight: RowHighlight, labels: RowLabel[]): string {
  const parts: string[] = [];
  if (highlight === "max-pos") parts.push("spx-odte-matrix-row--max-pos");
  if (highlight === "max-neg") parts.push("spx-odte-matrix-row--max-neg");
  if (labels.includes("Anchor")) parts.push("spx-odte-matrix-row--anchor");
  return parts.join(" ");
}

type DeskProps = {
  live?: boolean;
  pdh?: number | null;
  pdl?: number | null;
  priorClose?: number | null;
  /** Live index from merged desk — overlay only; structure levels use matrix spot. */
  liveSpot?: number | null;
  /** Near-term aggregate from desk header (8 nearest expiries) — parity reference. */
  deskGammaFlip?: number | null;
  deskGexKing?: number | null;
  gexStale?: boolean;
};

export function SpxOdteMatrixPanel({
  live: deskLive,
  pdh,
  pdl,
  priorClose,
  liveSpot,
  deskGammaFlip,
  deskGexKing,
  gexStale,
}: DeskProps) {
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

  const todayEt = useMemo(() => todayEtYmd(), []);
  const expiries = data?.expiries ?? [];
  const strictZeroDte = useMemo(
    () => resolveZeroDteExpiry(expiries, todayEt),
    [expiries, todayEt]
  );
  const columnExpiry = useMemo(
    () => strictZeroDte ?? resolveOdteExpiry(expiries, todayEt),
    [strictZeroDte, expiries, todayEt]
  );
  const isTrueZeroDte = strictZeroDte != null && columnExpiry === strictZeroDte;
  const block = lens === "gex" ? data?.gex : data?.vex;
  const hasVex = Boolean(data?.vex && Object.keys(data.vex.cells ?? {}).length > 0);

  useEffect(() => {
    if (lens === "vex" && data != null && !hasVex) setLens("gex");
  }, [lens, data, hasVex]);

  const cells = block?.cells ?? {};

  const floorLevels = useMemo(
    () => floorPivots(pdh, pdl, priorClose),
    [pdh, pdl, priorClose]
  );

  const strikesAxis = useMemo(() => {
    const fromApi = (data?.strikes ?? []).filter(Number.isFinite);
    const base =
      fromApi.length > 0
        ? fromApi
        : Object.keys(cells)
            .map(Number)
            .filter(Number.isFinite);
    return mergeAxisWithPivots(base, floorLevels);
  }, [data?.strikes, cells, floorLevels]);

  const matrixSpot = data?.spot ?? 0;
  const overlaySpot =
    liveSpot != null && liveSpot > 0 ? liveSpot : matrixSpot > 0 ? matrixSpot : 0;

  const columnTotals = useMemo(
    () => columnTotalsForAxis(cells, strikesAxis, columnExpiry),
    [cells, strikesAxis, columnExpiry]
  );

  const levelTotals = useMemo(
    () => odteStrikeTotalsFromCells(cells, strikesAxis, columnExpiry),
    [cells, strikesAxis, columnExpiry]
  );

  const scopedLevels = useMemo(() => {
    if (lens === "gex") {
      return recomputeScopedGexLevels(levelTotals, matrixSpot);
    }
    const posWall =
      Object.entries(levelTotals).reduce<{ strike: number | null; v: number }>(
        (best, [s, v]) => {
          const strike = Number(s);
          if (!Number.isFinite(strike) || v <= 0) return best;
          return v > best.v ? { strike, v } : best;
        },
        { strike: null, v: -Infinity }
      ).strike;
    const negWall =
      Object.entries(levelTotals).reduce<{ strike: number | null; v: number }>(
        (best, [s, v]) => {
          const strike = Number(s);
          if (!Number.isFinite(strike) || v >= 0) return best;
          return v < best.v ? { strike, v } : best;
        },
        { strike: null, v: Infinity }
      ).strike;
    let netTotal = 0;
    for (const v of Object.values(levelTotals)) {
      if (Number.isFinite(v)) netTotal += v;
    }
    return {
      flip: computeZeroGammaFlip(levelTotals, matrixSpot),
      callWall: posWall,
      putWall: negWall,
      king: kingFromStrikeTotals(levelTotals),
      netTotal,
    };
  }, [levelTotals, matrixSpot, lens]);

  const anchor = scopedLevels.king;
  const maxPosStrike = scopedLevels.callWall;
  const maxNegStrike = scopedLevels.putWall;

  const spotStrike = useMemo(() => {
    const strikes = Object.keys(columnTotals)
      .map(Number)
      .filter(Number.isFinite);
    if (!(overlaySpot > 0) || strikes.length === 0) return null;
    return strikes.reduce((best, s) =>
      Math.abs(s - overlaySpot) < Math.abs(best - overlaySpot) ? s : best
    );
  }, [columnTotals, overlaySpot]);

  const rows = useMemo<MatrixRow[]>(() => {
    return strikesAxis.map((strike) => {
      const labels: RowLabel[] = [];
      if (anchor != null && strike === anchor) labels.push("Anchor");
      if (maxPosStrike != null && strike === maxPosStrike) labels.push("Max +");
      if (maxNegStrike != null && strike === maxNegStrike) labels.push("Max −");

      const isMaxPos = labels.includes("Max +");
      const isMaxNeg = labels.includes("Max −");

      let highlight: RowHighlight = null;
      if (isMaxPos) highlight = "max-pos";
      else if (isMaxNeg) highlight = "max-neg";

      return {
        strike,
        value: columnTotals[String(strike)] ?? 0,
        highlight,
        labels,
        spotOnStrike: false,
      };
    });
  }, [strikesAxis, columnTotals, maxPosStrike, maxNegStrike, anchor]);

  const displayRows = useMemo(() => {
    const overlays = overlaysFromPivots(overlaySpot, floorLevels);
    return buildDisplayRows(rows, overlays);
  }, [rows, overlaySpot, floorLevels]);

  const scrollSpotKey = useMemo(() => {
    if (!(overlaySpot > 0)) return null;
    const onStrike =
      spotStrike != null && Math.abs(overlaySpot - spotStrike) < LEVEL_ON_STRIKE_EPS;
    if (onStrike) return `strike-${spotStrike}`;
    return `level-spot-${overlaySpot.toFixed(2)}`;
  }, [overlaySpot, spotStrike]);

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

  const hasData = Boolean(data?.available) && strikesAxis.length > 0 && columnExpiry != null;
  const feedLive = Boolean(deskLive) && hasData && !error && !gexStale;
  const asofLabel = fmtAsofSeconds(data?.asof);
  const expiryHeader = columnExpiry ? fmtExpiryHeader(columnExpiry) : "—";
  const scopeKicker = isTrueZeroDte ? "0DTE" : columnExpiry ? "Front expiry" : "—";

  const flipDiffersFromDesk =
    lens === "gex" &&
    scopedLevels.flip != null &&
    deskGammaFlip != null &&
    Math.abs(scopedLevels.flip - deskGammaFlip) > 1;
  const kingDiffersFromDesk =
    lens === "gex" &&
    anchor != null &&
    deskGexKing != null &&
    Math.abs(anchor - deskGexKing) > 0;

  const pivotLabel = lens === "gex" ? "γ flip" : "vanna flip";
  const lensLabel = lens === "gex" ? "GEX" : "VEX";
  const panelAccent = lens === "gex" ? "bull" : "sky";

  return (
    <Panel
      accent={panelAccent}
      kicker={
        columnExpiry
          ? `${scopeKicker} · ${columnExpiry} · ${lensLabel}`
          : `${scopeKicker} · ${lensLabel}`
      }
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
          {gexStale ? (
            <span className="text-amber-300/90 uppercase tracking-wider">GEX stale</span>
          ) : null}
          {asofLabel ? <span>structure {asofLabel} ET</span> : null}
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
              {scopedLevels.flip != null ? fmtStrike(scopedLevels.flip) : "—"}
            </div>
          </div>
          <div>
            <span className="text-white/50 uppercase tracking-wider">Net {lensLabel}</span>
            <div className="text-sm font-bold tabular-nums text-white">
              {hasData ? fmtMoneySigned(scopedLevels.netTotal) : "—"}
            </div>
          </div>
        </div>
        {(flipDiffersFromDesk || kingDiffersFromDesk) && (
          <p className="font-mono text-[9px] leading-snug text-white/45">
            Header uses near-term aggregate (8 expiries).
            {flipDiffersFromDesk && deskGammaFlip != null
              ? ` Desk γ flip ${fmtStrike(deskGammaFlip)}.`
              : ""}
            {kingDiffersFromDesk && deskGexKing != null
              ? ` Desk anchor ${fmtStrike(deskGexKing)}.`
              : ""}
          </p>
        )}
        {!isTrueZeroDte && columnExpiry ? (
          <p className="font-mono text-[9px] text-amber-200/80">
            No SPX 0DTE column on chain today — showing front expiry {columnExpiry}.
          </p>
        ) : null}
        {floorLevels ? (
          <div
            className="spx-odte-floor-pivots grid grid-cols-4 gap-1 font-mono text-[9px]"
            aria-label="Classic floor pivots from prior day high, low, and close"
          >
            {FLOOR_PIVOT_REFS.map(({ key, label, tone }) => (
              <div
                key={key}
                className={clsx(
                  "spx-odte-floor-pivot rounded border px-1 py-1 text-center",
                  tone === "resistance" && "spx-odte-floor-pivot--resistance",
                  tone === "support" && "spx-odte-floor-pivot--support"
                )}
              >
                <div className="font-bold uppercase tracking-wider opacity-80">{label}</div>
                <div className="text-[11px] font-bold tabular-nums text-white">
                  {fmtStrike(floorLevels[key])}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {isLoading && !data ? (
        <p className="font-mono text-[11px] text-white/60 py-4">Loading 0DTE matrix…</p>
      ) : error && !hasData ? (
        <p className="font-mono text-[11px] text-white/60 py-4">Matrix unavailable — retrying…</p>
      ) : !hasData ? (
        <p className="font-mono text-[11px] text-white/60 py-4">
          {columnExpiry == null ? "No expiry column on chain — retrying…" : "Mapping gamma nodes…"}
        </p>
      ) : (
        <div
          ref={scrollBoxRef}
          className="spx-odte-matrix-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain"
          aria-label={`SPX 0DTE net dealer ${lensLabel} by strike`}
        >
          <table className="spx-odte-matrix-table w-full border-collapse font-mono text-[12px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-[#08080e]">
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/55">
                <th className="py-2 pl-1 pr-1 text-left font-semibold">Strike</th>
                <th className="py-2 px-1 text-center font-semibold w-[4.5rem]">Label</th>
                <th className="py-2 pl-1 pr-2 text-right font-semibold">
                  {expiryHeader}
                  <span className="ml-1 text-[9px] normal-case tracking-normal text-white/40">
                    {lensLabel}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((item) => {
                if (item.kind === "level") {
                  const isSpot = item.tone === "spot";
                  return (
                    <tr
                      key={`level-${item.labels.join("-")}-${item.price.toFixed(2)}`}
                      ref={isSpot ? spotRowRef : undefined}
                      className={clsx(
                        "spx-odte-matrix-level-row border-b border-white/[0.06]",
                        isSpot && "spx-odte-matrix-spot-row spx-odte-matrix-spot-blink",
                        item.tone === "resistance" && "spx-odte-matrix-level-row--resistance",
                        item.tone === "support" && "spx-odte-matrix-level-row--support"
                      )}
                      aria-label={`${item.labels.join(" ")} ${fmtPrice(item.price)}`}
                    >
                      <td className="spx-odte-matrix-strike py-1 pl-1 pr-1 text-left tabular-nums">
                        {fmtStrike(item.price)}
                      </td>
                      <td className="spx-odte-matrix-label-cell py-1 px-1 text-center">
                        <MatrixLabels labels={item.labels} />
                      </td>
                      <td className="spx-odte-matrix-value py-1 pl-1 pr-2 text-right text-white/35">
                        {isSpot ? (
                          <span className="spx-odte-matrix-live-spot font-bold text-white">
                            {fmtPrice(item.price)}
                          </span>
                        ) : (
                          "·"
                        )}
                      </td>
                    </tr>
                  );
                }

                const r = item.row;
                const hlClass = rowHighlightClass(r.highlight, r.labels);

                return (
                  <tr
                    key={r.strike}
                    ref={r.spotOnStrike ? spotRowRef : undefined}
                    className={clsx(
                      "spx-odte-matrix-row border-b border-white/[0.04]",
                      hlClass,
                      r.spotOnStrike && "spx-odte-matrix-row--spot-on-strike spx-odte-matrix-spot-blink"
                    )}
                  >
                    <td className="spx-odte-matrix-strike py-1 pl-1 pr-1 text-left">
                      {fmtStrike(r.strike)}
                    </td>
                    <td className="spx-odte-matrix-label-cell py-1 px-1 text-center">
                      <MatrixLabels labels={r.labels} />
                    </td>
                    <td className="spx-odte-matrix-value py-1 pl-1 pr-2 text-right">
                      {r.value !== 0 ? fmtMoneySigned(r.value) : "·"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 shrink-0 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] tracking-wide text-white/45">
        <span>King (|GEX|)</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-[#00e676]/90" aria-hidden /> Max +
          {lensLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-[#6d28d9]/80" aria-hidden /> Max −
          {lensLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-cyan-400/90 spx-odte-matrix-spot-blink" aria-hidden /> Spot
        </span>
        {floorLevels ? <span className="text-white/35">· classic floor pivots</span> : null}
        <span className="text-white/35">
          · {rows.length} strikes · refresh {Math.round(pollMs / 1000)}s
        </span>
      </div>
    </Panel>
  );
}
