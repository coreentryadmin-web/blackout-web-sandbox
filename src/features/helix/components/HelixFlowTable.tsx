"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { EmptyState, Skeleton } from "@/components/ui";
import {
  columnsForDensity,
  groupHeaderSpans,
  groupStartIds,
  tableMinWidth,
  tableGridTemplate,
  type HelixColumnDef,
  type HelixTableDensity,
} from "@/features/helix/lib/helix-table-columns";
import {
  daysToExpiry,
  flowSignals,
  fmtAskPct,
  fmtExpiryShort,
  fmtFill,
  fmtFullTimestamp,
  fmtIv,
  fmtOi,
  fmtOtm,
  fmtSpot,
  premiumDisplay,
  ruleLabel,
  sortFlows,
  type HelixFlowSortDir,
  type HelixFlowSortKey,
} from "@/features/helix/lib/helix-flow-format";
import {
  HELIX_TAPE_OVERSCAN,
  HELIX_TAPE_ROW_HEIGHT,
} from "@/features/helix/lib/helix-flow-limits";

const WHALE_PREMIUM = 1_000_000;

type SignalTone = "bull" | "bear" | "gold" | "sky" | "purple" | "ember";

function SignalPill({ label, tone }: { label: string; tone: SignalTone }) {
  return (
    <span className={clsx("helix-tape-signal", `helix-tape-signal--${tone}`)} title={label}>
      {label}
    </span>
  );
}

function colTdClass(col: HelixColumnDef, groupStarts: Set<string>) {
  return clsx(
    "helix-tape-cell",
    `helix-tape-cell--${col.id}`,
    col.align === "right" && "text-right",
    groupStarts.has(col.id) && col.id !== "time" && "helix-tape-cell--group-start",
    col.id === "time" && "helix-tape-cell--group-print"
  );
}

function colThClass(col: HelixColumnDef, groupStarts: Set<string>) {
  return clsx(
    "helix-tape-col-th",
    col.align === "right" && "text-right",
    groupStarts.has(col.id) && col.id !== "time" && "helix-tape-col-th--group-start",
    col.id === "time" && "helix-tape-col-th--group-print",
    col.sortKey && "helix-tape-col-th--sortable"
  );
}

function SkeletonRows({ cols, groupStarts }: { cols: HelixColumnDef[]; groupStarts: Set<string> }) {
  // Grid rows (role=row) — no <tbody>; the parent .helix-tape-body is the rowgroup. Each row applies
  // the shared grid-template-columns via CSS, so skeleton cells sit in the same columns as real data.
  return (
    <>
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          role="row"
          className={clsx("helix-tape-row", i % 2 === 1 && "helix-tape-row--zebra")}
        >
          {cols.map((col) => (
            <div key={col.id} role="gridcell" className={colTdClass(col, groupStarts)}>
              <Skeleton
                width={col.id === "ticker" ? 52 : col.id === "premium" ? 64 : 40}
                height={col.id === "premium" ? 14 : 12}
                rounded="sm"
              />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function renderCell(
  col: HelixColumnDef,
  flow: FlowAlert,
  ctx: {
    isCall: boolean;
    isWhale: boolean;
    dte: number;
    is0dte: boolean;
    signals: ReturnType<typeof flowSignals>;
    isStarred: boolean;
    onToggleStar?: (ticker: string) => void;
    onTickerClick?: (ticker: string) => void;
  }
) {
  const { isCall, isWhale, dte, is0dte, signals, isStarred, onToggleStar, onTickerClick } = ctx;
  const visibleSignals = signals.slice(0, 3);
  const extraSignals = signals.length - visibleSignals.length;

  switch (col.id) {
    case "time":
      // Full absolute ET stamp "MM/DD/YYYY - HH:MM" (was a relative age via timeAgo). fmtFullTimestamp
      // returns "—" for empty/invalid, so no separate guard is needed. tabular-nums keeps it aligned.
      return <span className="helix-tape-time tabular-nums">{fmtFullTimestamp(flow.alerted_at)}</span>;
    case "ticker":
      return (
        <div className="helix-tape-symbol">
          {onToggleStar && (
            <button
              type="button"
              className={clsx("helix-tape-star", isStarred && "helix-tape-star--on")}
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar(flow.ticker);
              }}
              aria-pressed={isStarred}
              aria-label={isStarred ? "Remove from watchlist" : "Add to watchlist"}
            >
              {isStarred ? "★" : "☆"}
            </button>
          )}
          <span
            className="helix-tape-symbol-text"
            onClick={(e) => {
              e.stopPropagation();
              onTickerClick?.(flow.ticker);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onTickerClick?.(flow.ticker);
              }
            }}
            role={onTickerClick ? "button" : undefined}
            tabIndex={onTickerClick ? 0 : undefined}
          >
            {flow.ticker}
          </span>
        </div>
      );
    case "side":
      return (
        <span className={clsx("helix-tape-side", isCall ? "helix-tape-side--call" : "helix-tape-side--put")}>
          {isCall ? "C" : "P"}
        </span>
      );
    case "expiry":
      return <span className="helix-tape-muted tabular-nums">{fmtExpiryShort(flow.expiry)}</span>;
    case "strike":
      return (
        <span className="helix-tape-strike tabular-nums">
          {flow.strike}
          <span className="helix-tape-strike-suffix">{isCall ? "C" : "P"}</span>
        </span>
      );
    case "premium":
      return (
        <span
          className={clsx(
            "helix-tape-premium tabular-nums",
            isCall ? "helix-tape-premium--call" : "helix-tape-premium--put",
            isWhale && "helix-tape-premium--whale"
          )}
        >
          {premiumDisplay(flow)}
        </span>
      );
    case "fill":
      return <span className="helix-tape-muted tabular-nums">{fmtFill(flow.fill_price)}</span>;
    case "dte":
      return is0dte ? (
        <span className="helix-tape-dte-zero tabular-nums">0</span>
      ) : (
        <span className="helix-tape-muted tabular-nums">{dte}</span>
      );
    case "spot":
      return <span className="helix-tape-muted tabular-nums">{fmtSpot(flow.underlying_price)}</span>;
    case "ask":
      return <span className="helix-tape-muted tabular-nums">{fmtAskPct(flow.ask_pct)}</span>;
    case "oi":
      return <span className="helix-tape-muted tabular-nums">{fmtOi(flow.open_interest)}</span>;
    case "iv":
      return <span className="helix-tape-muted tabular-nums">{fmtIv(flow.implied_volatility)}</span>;
    case "otm":
      return <span className="helix-tape-muted tabular-nums">{fmtOtm(flow.otm_pct)}</span>;
    case "rule":
      return (
        <span className="helix-tape-rule">
          {flow.alert_rule ? ruleLabel(flow.alert_rule) : flow.route?.slice(0, 8) || "—"}
        </span>
      );
    case "score":
      return (
        <span className="helix-tape-score tabular-nums">
          {flow.score > 0 ? flow.score.toFixed(1) : "—"}
        </span>
      );
    case "signals":
      return (
        <div className="helix-tape-signals">
          {visibleSignals.map((s) => (
            <SignalPill key={s.id} label={s.label} tone={s.tone} />
          ))}
          {extraSignals > 0 && (
            <span className="helix-tape-signal helix-tape-signal--muted">+{extraSignals}</span>
          )}
        </div>
      );
    default:
      return "—";
  }
}

export function HelixFlowTable({
  flows,
  live,
  loading,
  density = "standard",
  typeFilter = "ALL",
  tickerFilter,
  hasData = false,
  compoundTickers,
  onTickerClick,
  onContractClick,
  replayMode = false,
  splitFlowTickers,
  earningsDays,
  velocitySpikeTickers,
  coordinatedTickers,
  hawkTickers,
  watchlistTickers,
  onToggleStar,
  filteredCount,
  hasMorePages = false,
  loadingOlder = false,
  autoBackfilling = false,
  onLoadOlder,
  totalLoaded,
}: {
  flows: FlowAlert[];
  live?: boolean;
  loading?: boolean;
  density?: HelixTableDensity;
  typeFilter?: "ALL" | "CALL" | "PUT";
  tickerFilter?: string;
  hasData?: boolean;
  compoundTickers?: Set<string>;
  onTickerClick?: (ticker: string) => void;
  onContractClick?: (flow: FlowAlert) => void;
  replayMode?: boolean;
  splitFlowTickers?: Set<string>;
  earningsDays?: Record<string, number>;
  velocitySpikeTickers?: Set<string>;
  coordinatedTickers?: Set<string>;
  hawkTickers?: Set<string>;
  watchlistTickers?: Set<string>;
  onToggleStar?: (ticker: string) => void;
  /** Total matching rows before render cap — shown in tape chrome */
  filteredCount?: number;
  /** Server cursor pagination — more history exists in Postgres */
  hasMorePages?: boolean;
  loadingOlder?: boolean;
  /** True while auto-backfill is fetching older pages for an active filter. */
  autoBackfilling?: boolean;
  onLoadOlder?: () => void;
  /** Total rows loaded in memory (may exceed filtered count) */
  totalLoaded?: number;
}) {
  const cols = useMemo(() => columnsForDensity(density), [density]);
  const groupSpans = useMemo(() => groupHeaderSpans(cols), [cols]);
  const groupStarts = useMemo(() => groupStartIds(cols), [cols]);
  const gridMinWidth = useMemo(() => tableMinWidth(cols), [cols]);
  // Single grid-template-columns string shared (via the --helix-tape-cols CSS var) by the header
  // rows AND every data row. Because column geometry is defined ONCE and every row consumes the
  // same tracks, header↔body columns are structurally locked together at every viewport width —
  // the alignment the old table-layout:fixed + percentage-colgroup lost on mobile. gridMinWidth is
  // the aggregate scroll floor so a narrow screen scrolls horizontally instead of crushing columns.
  const gridTemplate = useMemo(() => tableGridTemplate(cols), [cols]);

  const [sortKey, setSortKey] = useState<HelixFlowSortKey>("time");
  const [sortDir, setSortDir] = useState<HelixFlowSortDir>("desc");
  const scrollRef = useRef<HTMLDivElement>(null);

  const typed = useMemo(
    () =>
      flows.filter((f) => {
        const t = f.option_type?.toUpperCase();
        return t === "CALL" || t === "PUT";
      }),
    [flows]
  );

  const filtered = useMemo(() => {
    const base =
      typeFilter === "ALL"
        ? typed
        : typed.filter((f) => f.option_type?.toUpperCase() === typeFilter);
    if (sortKey === "time") return sortFlows(base, "time", "desc");
    return sortFlows(base, sortKey, sortDir);
  }, [typed, typeFilter, sortKey, sortDir]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => HELIX_TAPE_ROW_HEIGHT,
    overscan: HELIX_TAPE_OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const total = filteredCount ?? filtered.length;
  const loaded = totalLoaded ?? flows.length;
  const feedDown = !loading && !replayMode && !live;

  const toggleSort = (key: HelixFlowSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "time" || key === "premium" || key === "score" ? "desc" : "asc");
    }
  };

  return (
    <div className="helix-tape desk-panel flex flex-1 flex-col min-h-0">
      {/* The big "LIVE INSTITUTIONAL TAPE / FLOW PRINTS" title block was removed: it duplicated the
          page-level HELIX brand + "Institutional flow intelligence" header (HelixPageShell). Only the
          one-line usage hint and the live status chip (print count / render cap / density) remain, so
          the live signal is preserved without the redundant heading. */}
      <div className="helix-tape-chrome">
        {/* hint removed — the table interaction is self-evident */}
        {!loading && (
          <div className="helix-tape-chrome-meta tabular-nums">
            <span className="helix-tape-meta-count">{total.toLocaleString()} prints</span>
            {loaded > total && (
              <span className="helix-tape-meta-sub">{loaded.toLocaleString()} loaded</span>
            )}
            {hasMorePages && (
              <span className="helix-tape-meta-sub">more in history</span>
            )}
          </div>
        )}
      </div>

      {feedDown && (
        <div className="helix-tape-alert" role="alert">
          Feed unavailable — retrying in background
        </div>
      )}

      <div ref={scrollRef} className="helix-tape-scroll flow-scroll">
        {/* CSS-grid "table" (not a real <table>): the shared --helix-tape-cols template drives the
            header rows and every data row identically, so columns can't decouple. minWidth is the
            horizontal-scroll floor. See tableGridTemplate() for the WHY. */}
        <div
          className="helix-tape-grid"
          role="grid"
          aria-label="Live options flow table"
          style={{ minWidth: gridMinWidth, ["--helix-tape-cols" as string]: gridTemplate }}
        >
          <div className="helix-tape-head" role="rowgroup">
            <div className="helix-tape-group-row" role="row">
              {groupSpans.map((g) => (
                <div
                  key={g.group}
                  role="columnheader"
                  aria-colspan={g.span}
                  className={clsx("helix-tape-group-th", `helix-tape-group-th--${g.group}`)}
                  // Group headers span their member columns in the SAME grid the rows use.
                  style={{ gridColumn: `span ${g.span}` }}
                >
                  {g.label}
                </div>
              ))}
            </div>
            <div className="helix-tape-col-row" role="row">
              {cols.map((col) => (
                <div
                  key={col.id}
                  role="columnheader"
                  className={colThClass(col, groupStarts)}
                  title={col.hint}
                >
                  {col.sortKey ? (
                    <button
                      type="button"
                      className="helix-tape-sort-btn"
                      onClick={() => toggleSort(col.sortKey!)}
                      aria-sort={
                        sortKey === col.sortKey
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <span>{col.shortLabel ?? col.label}</span>
                      {sortKey === col.sortKey && (
                        <span className="helix-tape-sort-ind" aria-hidden>
                          {sortDir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span>{col.shortLabel ?? col.label}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="helix-tape-body" role="rowgroup">
              <SkeletonRows cols={cols} groupStarts={groupStarts} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="helix-tape-body" role="rowgroup">
              {/* Empty state spans the whole grid width (plain block, not a grid row). */}
              <div className="helix-tape-empty">
                <EmptyState
                  className="!border-transparent !bg-transparent !py-16"
                  title={
                    tickerFilter
                      ? `No prints for ${tickerFilter}`
                      : typeFilter !== "ALL"
                        ? `No ${typeFilter} prints`
                        : "Watching the tape"
                  }
                  description={
                    hasData
                      ? "Filters are active — widen floor or clear symbol to see more."
                      : live
                        ? "Acquiring flow…"
                        : "Reconnecting…"
                  }
                />
              </div>
            </div>
          ) : (
            <div
              className="helix-tape-body"
              role="rowgroup"
              style={{ height: virtualizer.getTotalSize(), position: "relative" }}
            >
              {virtualRows.map((vRow) => {
                const flow = filtered[vRow.index];
                if (!flow) return null;
                const i = vRow.index;
                const isCall = flow.option_type?.toUpperCase() === "CALL";
                const isWhale = flow.premium >= WHALE_PREMIUM;
                const dte = flow.dte ?? daysToExpiry(flow.expiry);
                const is0dte = dte === 0;
                const isCompound = compoundTickers?.has(flow.ticker) ?? false;
                const earnIn = earningsDays?.[flow.ticker] ?? null;
                const signals = flowSignals(flow, {
                  isWhale,
                  isCompound,
                  is0dte,
                  hasSplit: splitFlowTickers?.has(flow.ticker),
                  hasVelocity: velocitySpikeTickers?.has(flow.ticker),
                  hasCoord: coordinatedTickers?.has(flow.ticker),
                  isHawk: hawkTickers?.has(flow.ticker),
                  earnIn,
                });
                const isStarred = watchlistTickers?.has(flow.ticker) ?? false;
                const isNew = i === 0 && sortKey === "time" && sortDir === "desc";

                const interactive = Boolean(onContractClick || onTickerClick);
                return (
                  <div
                    key={`${flow.ticker}-${flow.alerted_at}-${flow.strike}-${i}`}
                    role="row"
                    data-helix-tape-row=""
                    data-index={vRow.index}
                    ref={virtualizer.measureElement}
                    className={clsx(
                      "helix-tape-row",
                      i % 2 === 1 && "helix-tape-row--zebra",
                      isCall ? "helix-tape-row--call" : "helix-tape-row--put",
                      isCompound && "helix-tape-row--stack",
                      isWhale && "helix-tape-row--whale",
                      isNew && "helix-tape-row--flash"
                    )}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vRow.start}px)`,
                    }}
                    onClick={() => {
                      if (onContractClick) onContractClick(flow);
                      else onTickerClick?.(flow.ticker);
                    }}
                    onKeyDown={
                      interactive
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (onContractClick) onContractClick(flow);
                              else onTickerClick?.(flow.ticker);
                            }
                          }
                        : undefined
                    }
                    tabIndex={interactive ? 0 : undefined}
                  >
                    {cols.map((col) => (
                      <div key={col.id} role="gridcell" className={colTdClass(col, groupStarts)}>
                        {renderCell(col, flow, {
                          isCall,
                          isWhale,
                          dte,
                          is0dte,
                          signals,
                          isStarred,
                          onToggleStar,
                          onTickerClick,
                        })}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {hasMorePages && onLoadOlder && !loading && (
          <button
            type="button"
            className="helix-tape-load-more"
            disabled={loadingOlder}
            onClick={onLoadOlder}
          >
            {loadingOlder
              ? autoBackfilling
                ? "Loading matching prints…"
                : "Loading older prints…"
              : autoBackfilling
                ? "Loading matching prints…"
                : "Load older prints from history"}
          </button>
        )}
      </div>
    </div>
  );
}
