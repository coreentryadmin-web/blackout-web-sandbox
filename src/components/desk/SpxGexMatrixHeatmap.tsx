"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import Link from "next/link";
import { Panel } from "@/components/ui";
import { fmtPrice } from "@/lib/api";
import { usePollIntervalMs } from "@/hooks/use-et-market-open";
import {
  recomputeScopedGexLevels,
  resolveOdteExpiry,
  resolveZeroDteExpiry,
  odteStrikeTotalsFromCells,
  columnTotalsForAxis,
  kingFromStrikeTotals,
} from "@/lib/correctness/gex-odte-scope";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  fmtHeatmapExpiry,
  fmtHeatmapMoneySigned,
  fmtHeatmapStrike,
  heatmapCellStyle,
  heatmapCellTextStyle,
  type GexHeatmapLens,
} from "@/lib/gex-heatmap-display";

const MATRIX_POLL_RTH_MS = 8_000;
const MATRIX_POLL_OFF_MS = 20_000;
/** Near-term columns shown in the compact rail (matches competitor density). */
const MAX_EXPIRY_COLS = 6;

type MetricBlock = {
  cells: Record<string, Record<string, number>>;
  strike_totals: Record<string, number>;
  total: number;
  flip: number | null;
};

type GexHeatmapResponse = {
  available: boolean;
  spot?: number;
  asof?: string;
  expiries?: string[];
  strikes?: number[];
  gex?: MetricBlock;
  vex?: MetricBlock;
  cross_validation?: {
    callWallMatch: boolean;
    putWallMatch: boolean;
    flipMatch: boolean;
    divergence: number | null;
    uw_asof: string | null;
  } | null;
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

type DeskProps = {
  live?: boolean;
  liveSpot?: number | null;
  deskGammaFlip?: number | null;
  deskGexKing?: number | null;
  gexStale?: boolean;
};

export function SpxGexMatrixHeatmap({
  live: deskLive,
  liveSpot,
  deskGammaFlip,
  deskGexKing,
  gexStale,
}: DeskProps) {
  const [lens, setLens] = useState<GexHeatmapLens>("gex");
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
  const block = lens === "gex" ? data?.gex : data?.vex;
  const hasVex = Boolean(data?.vex && Object.keys(data.vex.cells ?? {}).length > 0);
  const cells = block?.cells ?? {};
  const expiriesAll = data?.expiries ?? [];
  const displayExpiries = useMemo(() => expiriesAll.slice(0, MAX_EXPIRY_COLS), [expiriesAll]);

  useEffect(() => {
    if (lens === "vex" && data != null && !hasVex) setLens("gex");
  }, [lens, data, hasVex]);

  const strikesAxis = useMemo(() => {
    const fromApi = (data?.strikes ?? []).filter(Number.isFinite);
    if (fromApi.length > 0) return fromApi;
    return Object.keys(cells)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
  }, [data?.strikes, cells]);

  // Each expiry column has its OWN King node (argmax |net GEX| for that single
  // expiry) — distinct from odteLevels.king below (front-expiry only) and the
  // desk header's 8-expiry-aggregate King shown in the disclaimer text. SPX
  // daily expiries settle independently, so a column's King can legitimately
  // differ day to day. Same per-column scoping gives the day's own highest-
  // positive (call wall) and highest-negative (put wall) gamma strikes —
  // recomputeScopedGexLevels's callWall/putWall selection doesn't depend on
  // spot, only its flip field does, so 0 is a safe placeholder here.
  const columnKings = useMemo(() => {
    const map = new Map<string, number>();
    for (const expiry of displayExpiries) {
      const king = kingFromStrikeTotals(columnTotalsForAxis(cells, strikesAxis, expiry));
      if (king != null) map.set(expiry, king);
    }
    return map;
  }, [displayExpiries, cells, strikesAxis]);

  const columnExtremeWalls = useMemo(() => {
    const map = new Map<string, { callWall: number | null; putWall: number | null }>();
    for (const expiry of displayExpiries) {
      const { callWall, putWall } = recomputeScopedGexLevels(
        columnTotalsForAxis(cells, strikesAxis, expiry),
        0
      );
      map.set(expiry, { callWall, putWall });
    }
    return map;
  }, [displayExpiries, cells, strikesAxis]);

  const strictZeroDte = useMemo(
    () => resolveZeroDteExpiry(expiriesAll, todayEt),
    [expiriesAll, todayEt]
  );
  const columnExpiry = strictZeroDte ?? resolveOdteExpiry(expiriesAll, todayEt);
  const isTrueZeroDte = strictZeroDte != null && columnExpiry === strictZeroDte;

  const matrixSpot = data?.spot ?? 0;
  const overlaySpot =
    liveSpot != null && liveSpot > 0 ? liveSpot : matrixSpot > 0 ? matrixSpot : 0;

  const odteTotals = useMemo(
    () => odteStrikeTotalsFromCells(cells, strikesAxis, columnExpiry),
    [cells, strikesAxis, columnExpiry]
  );
  const odteLevels = useMemo(
    () => recomputeScopedGexLevels(odteTotals, matrixSpot),
    [odteTotals, matrixSpot]
  );

  const peak = useMemo(() => {
    let p = 0;
    for (const strike of strikesAxis) {
      const row = cells[String(strike)];
      if (!row) continue;
      for (const e of displayExpiries) {
        const v = row[e];
        if (typeof v === "number" && Number.isFinite(v)) {
          p = Math.max(p, Math.abs(v));
        }
      }
    }
    return p;
  }, [cells, strikesAxis, displayExpiries]);

  const spotStrike = useMemo(() => {
    if (!(overlaySpot > 0) || strikesAxis.length === 0) return null;
    return strikesAxis.reduce((best, s) =>
      Math.abs(s - overlaySpot) < Math.abs(best - overlaySpot) ? s : best
    );
  }, [strikesAxis, overlaySpot]);

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
  }, [spotStrike, data?.asof]);

  const hasData = Boolean(data?.available) && strikesAxis.length > 0 && displayExpiries.length > 0;
  const feedLive = Boolean(deskLive) && hasData && !error && !gexStale;
  const asofLabel = fmtAsofSeconds(data?.asof);
  const lensLabel = lens === "gex" ? "GEX" : "VEX";
  const panelAccent = lens === "gex" ? "bull" : "sky";

  const flipDiffers =
    lens === "gex" &&
    odteLevels.flip != null &&
    deskGammaFlip != null &&
    Math.abs(odteLevels.flip - deskGammaFlip) > 1;

  const uwCross = data?.cross_validation;
  const uwDiverged =
    uwCross?.divergence != null &&
    uwCross.divergence > 5 &&
    !(uwCross.callWallMatch && uwCross.putWallMatch && uwCross.flipMatch);

  return (
    <Panel
      accent={panelAccent}
      kicker={`SPX · ${lensLabel} matrix · near-term`}
      title="Dealer gamma map"
      actions={
        <span className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-white/70">
          {isValidating && !isLoading && <span className="text-white/50">↻</span>}
          <span
            className={clsx("badge-live-dot", feedLive ? "animate-pulse" : "opacity-40")}
            aria-hidden
          />
          {gexStale && (
            <span className="text-amber-300/90 uppercase tracking-wider">GEX stale</span>
          )}
          {asofLabel ? <span>{asofLabel} ET</span> : null}
        </span>
      }
      className="spx-odte-matrix-panel spx-gex-matrix-heatmap flex flex-1 min-h-0 flex-col"
      bodyClassName="spx-odte-matrix-body !px-1 !py-2 flex flex-1 min-h-0 flex-col"
    >
      <div className="mb-2 shrink-0 space-y-2 px-1">
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
                  "spx-odte-lens-toggle flex-1 rounded border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] transition-colors",
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
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px]">
          <div>
            <span className="text-white/50 uppercase tracking-wider">
              γ flip {isTrueZeroDte ? "(0DTE)" : "(col)"}
            </span>
            <div className="text-sm font-bold tabular-nums text-white">
              {odteLevels.flip != null ? fmtHeatmapStrike(odteLevels.flip) : "—"}
            </div>
          </div>
          <div>
            <span className="text-white/50 uppercase tracking-wider">Net {lensLabel}</span>
            <div className="text-sm font-bold tabular-nums text-white">
              {hasData ? fmtHeatmapMoneySigned(odteLevels.netTotal) : "—"}
            </div>
          </div>
        </div>
        {flipDiffers && deskGammaFlip != null && (
          <p className="font-mono text-[9px] leading-snug text-white/45">
            Header γ flip {fmtHeatmapStrike(deskGammaFlip)} uses 8-expiry aggregate.
            {deskGexKing != null ? ` King ${fmtHeatmapStrike(deskGexKing)}.` : ""}
          </p>
        )}
        {!isTrueZeroDte && columnExpiry && (
          <p className="font-mono text-[9px] text-amber-200/80">
            No 0DTE column today — levels use front expiry {columnExpiry}.
          </p>
        )}
        {uwDiverged && (
          <p className="font-mono text-[9px] leading-snug text-amber-300/90">
            UW oracle diverges {uwCross?.divergence?.toFixed(0)}pt from Polygon walls — treat
            levels as provisional until channels agree.
          </p>
        )}
      </div>

      {isLoading && !data ? (
        <p className="font-mono text-[11px] text-white/60 py-4 px-2">Loading gamma matrix…</p>
      ) : error && !hasData ? (
        <p className="font-mono text-[11px] text-white/60 py-4 px-2">Matrix unavailable — retrying…</p>
      ) : !hasData ? (
        <p className="font-mono text-[11px] text-white/60 py-4 px-2">Mapping dealer nodes…</p>
      ) : (
        <div
          ref={scrollBoxRef}
          className="spx-gex-matrix-scroll flex-1 min-h-0 overflow-auto overscroll-contain"
        >
          <table className="spx-gex-matrix-table w-max min-w-full border-collapse font-mono text-[12px] tabular-nums">
            <thead className="sticky top-0 z-20 bg-[#08080e]">
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/55">
                <th className="sticky left-0 z-30 bg-[#08080e] py-1.5 pl-1 pr-2 text-left font-semibold">
                  Strike
                </th>
                {displayExpiries.map((e) => (
                  <th key={e} className="py-1.5 px-1 text-center font-semibold whitespace-nowrap">
                    {fmtHeatmapExpiry(e)}
                  </th>
                ))}
                <th className="py-1.5 pl-1 pr-2 text-right font-semibold whitespace-nowrap">Net</th>
              </tr>
            </thead>
            <tbody>
              {strikesAxis.map((strike) => {
                const isSpotRow = spotStrike === strike;
                const rowCells = cells[String(strike)] ?? {};
                const rowTotal = block?.strike_totals?.[String(strike)] ?? 0;
                const isKing =
                  lens === "gex" &&
                  odteLevels.king != null &&
                  strike === odteLevels.king;
                const isCallWall =
                  odteLevels.callWall != null && strike === odteLevels.callWall;
                const isPutWall =
                  odteLevels.putWall != null && strike === odteLevels.putWall;

                return (
                  <tr
                    key={strike}
                    ref={isSpotRow ? spotRowRef : undefined}
                    className={clsx(
                      "border-b border-white/[0.04]",
                      isSpotRow && "spx-gex-matrix-spot-row",
                      isKing && "spx-odte-matrix-row--anchor",
                      isCallWall && "spx-odte-matrix-row--max-pos",
                      isPutWall && "spx-odte-matrix-row--max-neg"
                    )}
                  >
                    <td
                      className={clsx(
                        "sticky left-0 z-10 bg-[#08080e] py-1 pl-1 pr-2 text-left font-bold",
                        isSpotRow && "text-cyan-300"
                      )}
                    >
                      {fmtHeatmapStrike(strike)}
                      {isSpotRow && overlaySpot > 0 && Math.abs(strike - overlaySpot) >= 0.5 && (
                        <span className="block text-[8px] font-normal text-cyan-400/80">
                          ← {fmtPrice(overlaySpot)}
                        </span>
                      )}
                    </td>
                    {displayExpiries.map((e) => {
                      const v = rowCells[e];
                      const has = typeof v === "number" && Number.isFinite(v);
                      const val = has ? v : 0;
                      const isColumnKing = columnKings.get(e) === strike;
                      const columnExtremes = columnExtremeWalls.get(e);
                      const isColumnCallWall = has && columnExtremes?.callWall === strike;
                      const isColumnPutWall = has && columnExtremes?.putWall === strike;
                      const extremeTitle = isColumnCallWall
                        ? `Highest positive gamma for ${fmtHeatmapExpiry(e)}`
                        : isColumnPutWall
                          ? `Highest negative gamma for ${fmtHeatmapExpiry(e)}`
                          : undefined;
                      return (
                        <td
                          key={e}
                          className={clsx(
                            "whitespace-nowrap px-1 py-1 text-center font-bold",
                            has && val > 0 && "text-emerald-300",
                            has && val < 0 && "text-rose-300",
                            !has && "text-sky-300/25"
                          )}
                          style={{
                            ...(has ? heatmapCellStyle(val, peak, lens) : {}),
                            ...(has ? heatmapCellTextStyle(val, peak) : {}),
                          }}
                          title={
                            isColumnKing
                              ? `King node for ${fmtHeatmapExpiry(e)}${
                                  overlaySpot > 0
                                    ? ` — ${Math.round(Math.abs(strike - overlaySpot))}pt from spot`
                                    : ""
                                }`
                              : extremeTitle
                          }
                        >
                          <span
                            className={clsx(
                              (isColumnCallWall || isColumnPutWall) && "spx-gex-matrix-extreme-pop"
                            )}
                          >
                            {fmtHeatmapMoneySigned(val, { showZero: true })}
                          </span>
                          {isColumnKing && (
                            <span className="ml-0.5 inline-flex items-baseline gap-0.5">
                              <span
                                aria-hidden
                                className="text-[13px] leading-none text-amber-400 [text-shadow:0_0_6px_rgba(251,191,36,0.9)]"
                              >
                                ★
                              </span>
                              {overlaySpot > 0 && (
                                <span className="text-[7px] font-normal leading-none text-amber-300/70">
                                  {Math.round(Math.abs(strike - overlaySpot))}pt
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
                        rowTotal > 0 && "text-emerald-300",
                        rowTotal < 0 && "text-rose-300",
                        rowTotal === 0 && "text-sky-300/25"
                      )}
                      style={{
                        ...(rowTotal
                          ? {
                              ...heatmapCellStyle(rowTotal, peak, lens),
                              ...heatmapCellTextStyle(rowTotal, peak),
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
      )}

      <div className="mt-2 shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 font-mono text-[9px] text-white/45">
        <span>{strikesAxis.length} strikes · ±6% SPX band · {displayExpiries.length} expiries</span>
        {columnKings.size > 0 && (
          <span>
            · <span className="text-amber-400">★Npt</span> = that day&apos;s King node, N points
            from spot (close = live pin candidate; far = structural OI wall, not a live anchor)
          </span>
        )}
        {columnExtremeWalls.size > 0 && (
          <span>· pulsing cell = that day&apos;s highest +/- gamma</span>
        )}
        <span>· refresh {Math.round(pollMs / 1000)}s</span>
        <Link href="/heatmap" className="text-sky-400/90 hover:text-sky-300 underline-offset-2 hover:underline">
          Full Thermal →
        </Link>
      </div>
    </Panel>
  );
}
