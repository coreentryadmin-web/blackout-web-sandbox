"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { Panel } from "@/components/ui";
import { fmtPrice } from "@/lib/api";
import { useDeskSessionPollIntervalMs } from "@/hooks/use-et-market-open";
import { SPX_MATRIX_POLL_OFF_MS, SPX_MATRIX_POLL_RTH_MS } from "@/features/spx/lib/spx-desk-poll-ms";
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
import { gexKingDualLabel } from "@/lib/gex-king-node-labels";
import {
  readGexHeatmapSessionCache,
  writeGexHeatmapSessionCache,
} from "@/lib/gex-heatmap-session-cache";
import { SpxMatrixTapeStrip } from "./SpxMatrixTapeStrip";
import { SpxStrikeLadderAxis } from "./SpxStrikeLadderAxis";
import { scrollRowIntoViewCenter } from "@/features/spx/lib/spx-matrix-scroll";
import type { SpxTapeItem } from "@/features/spx/lib/spx-desk";
import type { VectorPriceScaleMap } from "@/features/vector/lib/vector-price-scale-map";

/** Persisted matrix view mode — ladder (shared chart axis, default) vs the dense table. */
const MATRIX_VIEW_STORAGE_KEY = "spx-matrix-view-mode";
type MatrixViewMode = "ladder" | "table";

const MATRIX_POLL_RTH_MS = SPX_MATRIX_POLL_RTH_MS;
const MATRIX_POLL_OFF_MS = SPX_MATRIX_POLL_OFF_MS;
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

type OpeningRange = {
  high: number;
  low: number;
  break: "above" | "below" | "inside" | null;
  forming: boolean;
};

type DeskProps = {
  live?: boolean;
  /** When true (RTH or premarket), matrix polls at 8s; off-session uses 20s. */
  sessionActive?: boolean;
  liveSpot?: number | null;
  deskGammaFlip?: number | null;
  deskGexKing?: number | null;
  gexStale?: boolean;
  openingRange?: OpeningRange | null;
  unifiedTape?: SpxTapeItem[];
  flow0dteNet?: number | null;
  flow0dteCallPrem?: number | null;
  flow0dtePutPrem?: number | null;
  /** SHARED PRICE AXIS (2026-07-13): the embedded Vector chart's live y-mapping — the ladder
   *  view renders strikes/spot at the SAME pixel heights as the chart. Null → linear fallback. */
  priceScaleMap?: VectorPriceScaleMap | null;
  /** FOCUS MODE (2026-07-13): collapse to a 48px king-strike rail on the shared axis. Data
   *  hooks keep running so exiting focus restores the full panel instantly. */
  focus?: boolean;
};

function nearestStrike(axis: number[], price: number): number | null {
  if (!(price > 0) || axis.length === 0) return null;
  return axis.reduce((best, s) =>
    Math.abs(s - price) < Math.abs(best - price) ? s : best
  );
}

export function SpxGexMatrixHeatmap({
  live: deskLive,
  sessionActive,
  liveSpot,
  deskGammaFlip,
  deskGexKing,
  gexStale,
  openingRange,
  unifiedTape,
  flow0dteNet,
  flow0dteCallPrem,
  flow0dtePutPrem,
  priceScaleMap,
  focus,
}: DeskProps) {
  const [lens, setLens] = useState<GexHeatmapLens>("gex");
  // Ladder is the default view (flagship shared-axis upgrade); the dense table stays one
  // click away. Hydrated from localStorage after mount so SSR markup is deterministic.
  const [view, setView] = useState<MatrixViewMode>("ladder");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MATRIX_VIEW_STORAGE_KEY);
      if (saved === "table" || saved === "ladder") setView(saved);
    } catch {
      /* storage unavailable — keep the default */
    }
  }, []);
  const pickView = (next: MatrixViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(MATRIX_VIEW_STORAGE_KEY, next);
    } catch {
      /* best-effort persistence */
    }
  };
  const pollMs = useDeskSessionPollIntervalMs(
    sessionActive ?? deskLive,
    MATRIX_POLL_RTH_MS,
    MATRIX_POLL_OFF_MS
  );
  const matrixKey = "/api/market/gex-heatmap?ticker=SPX";
  const cachedMatrix = useMemo(() => readGexHeatmapSessionCache<GexHeatmapResponse>("SPX"), []);

  const { data, isLoading, error, isValidating, mutate } = useSWR<GexHeatmapResponse>(
    matrixKey,
    fetchGexHeatmap,
    {
      refreshInterval: pollMs,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
      keepPreviousData: true,
      fallbackData: cachedMatrix,
      onSuccess: (payload) => {
        if (payload?.available && payload.gex?.strike_totals) {
          writeGexHeatmapSessionCache("SPX", payload);
        }
      },
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
    return nearestStrike(strikesAxis, overlaySpot);
  }, [strikesAxis, overlaySpot]);

  const orHighStrike = useMemo(
    () => (openingRange?.high != null ? nearestStrike(strikesAxis, openingRange.high) : null),
    [openingRange?.high, strikesAxis]
  );
  const orLowStrike = useMemo(
    () => (openingRange?.low != null ? nearestStrike(strikesAxis, openingRange.low) : null),
    [openingRange?.low, strikesAxis]
  );

  const hasData = Boolean(data?.available) && strikesAxis.length > 0 && displayExpiries.length > 0;

  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLTableRowElement | null>(null);
  const userPinnedScrollRef = useRef(false);
  const lastCenteredStrikeRef = useRef<number | null>(null);

  const centerSpotRow = (behavior: ScrollBehavior = "auto") => {
    const box = scrollBoxRef.current;
    const row = spotRowRef.current;
    if (box == null || row == null) return;
    // No vertical padding spacer — that hid the ladder in the narrow desk column.
    // Center by scrollTop only so rows are always in the document flow from y=0.
    if (behavior === "smooth") {
      const scrollRect = box.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const target =
        box.scrollTop +
        (rowRect.top - scrollRect.top - (scrollRect.height - rowRect.height) / 2);
      const max = Math.max(0, box.scrollHeight - box.clientHeight);
      box.scrollTo({ top: Math.max(0, Math.min(target, max)), behavior: "smooth" });
    } else {
      scrollRowIntoViewCenter(box, row);
    }
  };

  useEffect(() => {
    const box = scrollBoxRef.current;
    if (!box) return;
    const markPinned = () => {
      userPinnedScrollRef.current = true;
    };
    box.addEventListener("wheel", markPinned, { passive: true });
    box.addEventListener("touchmove", markPinned, { passive: true });
    box.addEventListener("pointerdown", markPinned, { passive: true });
    return () => {
      box.removeEventListener("wheel", markPinned);
      box.removeEventListener("touchmove", markPinned);
      box.removeEventListener("pointerdown", markPinned);
    };
  }, [hasData]);

  useLayoutEffect(() => {
    if (spotStrike == null || !hasData) return;

    const strikeMoved = lastCenteredStrikeRef.current !== spotStrike;
    if (strikeMoved) {
      userPinnedScrollRef.current = false;
      lastCenteredStrikeRef.current = spotStrike;
    }
    if (userPinnedScrollRef.current && !strikeMoved) return;

    const run = () => centerSpotRow(strikeMoved ? "smooth" : "auto");
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(run);
    });
    const t = window.setTimeout(run, 120);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t);
    };
  }, [spotStrike, hasData, lens, strikesAxis.length, overlaySpot]);

  useEffect(() => {
    const box = scrollBoxRef.current;
    if (!box || spotStrike == null) return;
    const ro = new ResizeObserver(() => {
      if (!userPinnedScrollRef.current) centerSpotRow("auto");
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [spotStrike, hasData]);

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

  const ladderTotals = block?.strike_totals ?? {};
  const ladderKing = lens === "gex" ? (odteLevels.king ?? null) : null;

  // FOCUS MODE rail — after all hooks (SWR keeps polling while collapsed, so exiting focus
  // restores a live panel, not a stale one). Only king/wall markers + spot on the shared axis.
  if (focus) {
    return (
      <div className="spx-matrix-focus-rail" aria-label="Ladder focus rail">
        <SpxStrikeLadderAxis
          variant="focus"
          strikes={strikesAxis}
          totals={ladderTotals}
          spot={overlaySpot > 0 ? overlaySpot : null}
          king={ladderKing}
          callWall={odteLevels.callWall ?? null}
          putWall={odteLevels.putWall ?? null}
          flip={odteLevels.flip ?? null}
          lens={lens}
          map={priceScaleMap ?? null}
        />
      </div>
    );
  }

  return (
    <Panel
      accent={panelAccent}
      kicker={`SPX · ${lensLabel} matrix · near-term`}
      title="Dealer gamma map"
      actions={
        <span className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-sky-300">
          <span
            className={clsx("badge-live-dot", feedLive ? "opacity-100" : "opacity-40")}
            aria-hidden
          />
          {gexStale && (
            <span className="text-amber-300/90 uppercase tracking-wider">GEX stale</span>
          )}
          {asofLabel ? <span>{asofLabel} ET</span> : null}
          {/* Manual refresh (user-directed 2026-07-14): revalidates ONLY this panel's SWR key
              (matrix data — no page reload) and recenters the ladder/table on spot when the
              fresh payload lands. Replaces the old bottom "Recenter on spot" button. */}
          <button
            type="button"
            className={clsx(
              "spx-matrix-refresh-btn",
              isValidating && "spx-matrix-refresh-btn--spinning"
            )}
            onClick={() => {
              userPinnedScrollRef.current = false;
              void mutate().finally(() => centerSpotRow("smooth"));
            }}
            title="Refresh gamma map data and recenter on spot"
            aria-label="Refresh dealer gamma map"
          >
            ↻
          </button>
        </span>
      }
      className="spx-odte-matrix-panel spx-gex-matrix-heatmap flex flex-1 min-h-0 flex-col overflow-hidden"
      bodyClassName="spx-odte-matrix-body !px-1 !py-2 flex flex-1 min-h-0 flex-col overflow-hidden"
    >
      <div className="mb-2 shrink-0 space-y-2 px-1">
        <div className="flex items-center gap-1.5">
        <div
          className="flex gap-1.5 flex-1 min-w-0"
          role="tablist"
          aria-label="Exposure lens"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setLens((prev) => (prev === "gex" ? "vex" : "gex"));
          }}
        >
          {(["gex", "vex"] as const).map((key) => {
            const active = lens === key;
            const disabled = key === "vex" && !hasVex && !isLoading;
            const panelId = key === "gex" ? "spx-matrix-lens-gex" : "spx-matrix-lens-vex";
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`spx-matrix-tab-${key}`}
                aria-selected={active}
                aria-controls={panelId}
                tabIndex={active ? 0 : -1}
                disabled={disabled}
                onClick={() => setLens(key)}
                className={clsx(
                  "spx-odte-lens-toggle flex-1 rounded border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em]",
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
        {/* Ladder (shared chart axis) ↔ dense table — one click each way, persisted. */}
        <div
          className="flex gap-0.5 shrink-0"
          role="group"
          aria-label="Matrix view mode"
        >
          {(["ladder", "table"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              id={`spx-matrix-view-${mode}`}
              aria-pressed={view === mode}
              onClick={() => pickView(mode)}
              title={
                mode === "ladder"
                  ? "Strike ladder on the chart's price axis"
                  : "Dense per-expiry table"
              }
              className={clsx(
                "spx-matrix-view-toggle rounded border px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em]",
                view === mode
                  ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                  : "border-white/10 text-sky-300/60 hover:text-sky-200"
              )}
            >
              {mode === "ladder" ? "Axis" : "Table"}
            </button>
          ))}
        </div>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px]">
          <div>
            <span className="text-sky-300 uppercase tracking-wider">
              γ flip {isTrueZeroDte ? "(0DTE)" : "(col)"}
            </span>
            <div className="text-sm font-bold tabular-nums text-white">
              {odteLevels.flip != null ? fmtHeatmapStrike(odteLevels.flip) : "—"}
            </div>
          </div>
          <div>
            <span className="text-sky-300 uppercase tracking-wider">Net {lensLabel}</span>
            <div className="text-sm font-bold tabular-nums text-white">
              {hasData ? fmtHeatmapMoneySigned(odteLevels.netTotal) : "—"}
            </div>
          </div>
          {openingRange && (
            <div className="col-span-2">
              <span className="text-sky-300 uppercase tracking-wider">
                Opening range {openingRange.forming ? "(forming)" : ""}
              </span>
              <div className="text-sm font-bold tabular-nums text-amber-200/95">
                {fmtHeatmapStrike(openingRange.low)} – {fmtHeatmapStrike(openingRange.high)}
                {openingRange.break && !openingRange.forming
                  ? ` · ${openingRange.break} OR`
                  : ""}
              </div>
            </div>
          )}
        </div>
        {flipDiffers && deskGammaFlip != null && (
          <p className="font-mono text-[9px] leading-snug text-cyan-400">
            Header γ flip {fmtHeatmapStrike(deskGammaFlip)} uses 8-expiry aggregate.
            {deskGexKing != null
              ? ` ${gexKingDualLabel("near-term")} ${fmtHeatmapStrike(deskGexKing)}.`
              : ""}
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
        <p className="font-mono text-[11px] text-sky-300 py-4 px-2">Loading gamma matrix…</p>
      ) : error && !hasData ? (
        <p className="font-mono text-[11px] text-sky-300 py-4 px-2">Matrix unavailable — retrying…</p>
      ) : !hasData ? (
        <p className="font-mono text-[11px] text-sky-300 py-4 px-2">Mapping dealer nodes…</p>
      ) : (
        <div
          id={lens === "gex" ? "spx-matrix-lens-gex" : "spx-matrix-lens-vex"}
          role="tabpanel"
          aria-labelledby={`spx-matrix-tab-${lens}`}
          className="flex flex-1 min-h-0 flex-col"
        >
        {view === "ladder" ? (
          // SHARED PRICE AXIS ladder — same data as the table (block strike_totals +
          // 0DTE-scoped king/walls/flip), positioned by the embedded chart's live y-scale.
          <SpxStrikeLadderAxis
            variant="full"
            strikes={strikesAxis}
            totals={ladderTotals}
            spot={overlaySpot > 0 ? overlaySpot : null}
            king={ladderKing}
            callWall={odteLevels.callWall ?? null}
            putWall={odteLevels.putWall ?? null}
            flip={odteLevels.flip ?? null}
            lens={lens}
            map={priceScaleMap ?? null}
          />
        ) : (
        <div
          ref={scrollBoxRef}
          className="spx-gex-matrix-scroll flex-1 min-h-0 overflow-y-scroll overflow-x-auto overscroll-contain"
          aria-label="SPX gamma matrix strike ladder"
        >
          <table
            className="spx-gex-matrix-table w-max border-collapse font-mono text-[12px] tabular-nums"
            role="grid"
            aria-label="SPX dealer gamma matrix by strike and expiry"
          >
            <thead className="sticky top-0 z-20 bg-[#08080e]">
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-sky-300">
                <th className="sticky left-0 z-30 bg-[#08080e] py-1.5 pl-1 pr-2 text-left font-semibold">
                  Strike
                </th>
                {displayExpiries.map((e) => (
                  <th
                    key={e}
                    className="spx-gex-matrix-expiry-col py-1.5 px-1 text-center font-semibold whitespace-nowrap"
                  >
                    {fmtHeatmapExpiry(e)}
                  </th>
                ))}
                <th className="spx-gex-matrix-net-col py-1.5 pl-1 pr-2 text-right font-semibold whitespace-nowrap">
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {strikesAxis.map((strike) => {
                const isSpotRow = spotStrike === strike;
                const isOrHigh = orHighStrike === strike;
                const isOrLow = orLowStrike === strike;
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
                      isOrHigh && "spx-gex-matrix-or-high",
                      isOrLow && "spx-gex-matrix-or-low",
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
                      {isOrHigh && openingRange && (
                        <span className="block text-[8px] font-normal text-amber-300/90">OR-H</span>
                      )}
                      {isOrLow && openingRange && (
                        <span className="block text-[8px] font-normal text-amber-300/90">OR-L</span>
                      )}
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
                            "spx-gex-matrix-expiry-col whitespace-nowrap px-1 py-1 text-center font-bold",
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
                              ? `${gexKingDualLabel()} for ${fmtHeatmapExpiry(e)}${
                                  overlaySpot > 0
                                    ? ` — ${Math.round(Math.abs(strike - overlaySpot))}pt from spot`
                                    : ""
                                }`
                              : extremeTitle
                          }
                        >
                          <span
                            className={clsx(
                              isColumnCallWall && "text-emerald-200",
                              isColumnPutWall && "text-rose-200"
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
                        "spx-gex-matrix-net-col whitespace-nowrap py-1 pl-1 pr-2 text-right font-bold",
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

        <SpxMatrixTapeStrip
          seed={unifiedTape}
          flow0dteNet={flow0dteNet}
          flowCallPrem={flow0dteCallPrem}
          flowPutPrem={flow0dtePutPrem}
        />
        {/* Bottom "Recenter on spot" removed (user-directed 2026-07-14) — the header refresh
            button now recenters after revalidating, and the row goes back to the panels. */}
        </div>
      )}
    </Panel>
  );
}
