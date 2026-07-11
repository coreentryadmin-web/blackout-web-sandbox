"use client";

import { useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { EmptyState, Skeleton } from "@/components/ui";
import {
  daysToExpiry,
  flowSignals,
  flowTimeMs,
  fmtAskPct,
  fmtExpiryShort,
  fmtIv,
  fmtOi,
  fmtOtm,
  fmtSpot,
  premiumDisplay,
  ruleLabel,
  sortFlows,
  timeAgo,
  type HelixFlowSortDir,
  type HelixFlowSortKey,
} from "@/features/helix/lib/helix-flow-format";

const WHALE_PREMIUM = 1_000_000;
const RENDER_LIMIT = 250;

const COLUMNS: { key: HelixFlowSortKey | null; label: string; align?: "left" | "right" }[] = [
  { key: "time", label: "Time" },
  { key: "ticker", label: "Ticker" },
  { key: null, label: "C/P" },
  { key: "expiry", label: "Exp" },
  { key: "strike", label: "Strike", align: "right" },
  { key: null, label: "Spot", align: "right" },
  { key: "premium", label: "Premium", align: "right" },
  { key: "dte", label: "DTE", align: "right" },
  { key: null, label: "Ask", align: "right" },
  { key: null, label: "OI", align: "right" },
  { key: null, label: "IV", align: "right" },
  { key: null, label: "OTM", align: "right" },
  { key: null, label: "Type" },
  { key: "score", label: "Sc", align: "right" },
  { key: null, label: "Signals" },
];

type SignalTone = "bull" | "bear" | "gold" | "sky" | "purple" | "ember";

function SignalPill({ label, tone }: { label: string; tone: SignalTone }) {
  return (
    <span className={clsx("helix-flow-signal", `helix-flow-signal--${tone}`)} title={label}>
      {label}
    </span>
  );
}

function SkeletonRows() {
  return (
    <tbody>
      {Array.from({ length: 12 }).map((_, i) => (
        <tr key={i} className="helix-flow-row">
          {COLUMNS.map((col) => (
            <td key={col.label}>
              <Skeleton width={col.key === "ticker" ? 48 : 36} height={12} rounded="sm" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function HelixFlowTable({
  flows,
  live,
  loading,
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
}: {
  flows: FlowAlert[];
  live?: boolean;
  loading?: boolean;
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
}) {
  const [sortKey, setSortKey] = useState<HelixFlowSortKey>("time");
  const [sortDir, setSortDir] = useState<HelixFlowSortDir>("desc");
  const [renderLimit, setRenderLimit] = useState(RENDER_LIMIT);
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

  const displayed = filtered.slice(0, renderLimit);
  const hasMore = filtered.length > renderLimit;
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
    <div className="helix-flow-terminal desk-panel">
      <div className="helix-flow-terminal-head">
        <div className="helix-flow-terminal-title">
          <span className="helix-pro-command-label">Live tape</span>
          <h2 className="font-mono text-[13px] font-semibold uppercase tracking-[0.14em] text-white">
            Institutional flow
          </h2>
        </div>
        <div className="helix-flow-terminal-meta font-mono text-[10px] text-sky-300/80 tabular-nums">
          {!loading && (
            <span>
              {filtered.length} prints
              {hasMore ? ` · showing ${renderLimit}` : ""}
            </span>
          )}
        </div>
      </div>

      {feedDown && (
        <div className="helix-flow-feed-alert" role="alert">
          Feed unavailable — retrying in background
        </div>
      )}

      <div ref={scrollRef} className="helix-flow-table-scroll flow-scroll">
        <table className="helix-flow-table" role="grid" aria-label="Live options flow table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  className={clsx(
                    col.align === "right" && "text-right",
                    col.key && "helix-flow-th-sortable"
                  )}
                >
                  {col.key ? (
                    <button
                      type="button"
                      className="helix-flow-th-btn"
                      onClick={() => toggleSort(col.key!)}
                      aria-sort={
                        sortKey === col.key
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      {col.label}
                      {sortKey === col.key && (
                        <span className="helix-flow-sort-ind" aria-hidden>
                          {sortDir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {loading ? (
            <SkeletonRows />
          ) : filtered.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={COLUMNS.length}>
                  <EmptyState
                    className="!border-transparent !bg-transparent !py-14"
                    title={
                      tickerFilter
                        ? `No prints for ${tickerFilter}`
                        : typeFilter !== "ALL"
                          ? `No ${typeFilter} prints`
                          : "Watching the tape"
                    }
                    description={
                      hasData
                        ? "Tape live — waiting for the next print…"
                        : live
                          ? "Acquiring flow…"
                          : "Reconnecting…"
                    }
                  />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {displayed.map((flow, i) => {
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
                const visibleSignals = signals.slice(0, 3);
                const extraSignals = signals.length - visibleSignals.length;
                const isStarred = watchlistTickers?.has(flow.ticker) ?? false;
                const isNew = i === 0 && sortKey === "time" && sortDir === "desc";

                return (
                  <tr
                    key={`${flow.ticker}-${flow.alerted_at}-${flow.strike}-${i}`}
                    className={clsx(
                      "helix-flow-row",
                      isCall ? "helix-flow-row--call" : "helix-flow-row--put",
                      isCompound && "helix-flow-row--compound",
                      isNew && "helix-flow-row--flash"
                    )}
                    onClick={() => {
                      if (onContractClick) onContractClick(flow);
                      else onTickerClick?.(flow.ticker);
                    }}
                    onKeyDown={
                      onContractClick || onTickerClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (onContractClick) onContractClick(flow);
                              else onTickerClick?.(flow.ticker);
                            }
                          }
                        : undefined
                    }
                    role={onContractClick || onTickerClick ? "button" : undefined}
                    tabIndex={onContractClick || onTickerClick ? 0 : undefined}
                  >
                    <td className="helix-flow-cell-time tabular-nums text-sky-300/90">
                      {flowTimeMs(flow) ? timeAgo(flow.alerted_at) : "—"}
                    </td>
                    <td className="helix-flow-cell-ticker">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {onToggleStar && (
                          <button
                            type="button"
                            className={clsx(
                              "helix-flow-star",
                              isStarred ? "text-gold" : "text-cyan-500/50 hover:text-gold"
                            )}
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
                          className="font-mono text-[12px] font-bold text-white tracking-wide hover:text-cyan-300"
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
                    </td>
                    <td>
                      <span
                        className={clsx(
                          "helix-flow-cp",
                          isCall ? "helix-flow-cp--call" : "helix-flow-cp--put"
                        )}
                      >
                        {isCall ? "C" : "P"}
                      </span>
                    </td>
                    <td className="tabular-nums text-sky-300/90">{fmtExpiryShort(flow.expiry)}</td>
                    <td className="text-right tabular-nums font-semibold text-gold/95">
                      {flow.strike}
                      {isCall ? "C" : "P"}
                    </td>
                    <td className="text-right tabular-nums text-sky-200/90">
                      {fmtSpot(flow.underlying_price)}
                    </td>
                    <td
                      className={clsx(
                        "text-right tabular-nums font-bold text-[13px]",
                        isCall ? "text-bull" : "text-bear-text"
                      )}
                    >
                      {premiumDisplay(flow)}
                    </td>
                    <td className="text-right tabular-nums text-sky-300/80">
                      {is0dte ? <span className="text-ember font-semibold">0</span> : dte}
                    </td>
                    <td className="text-right tabular-nums text-sky-300/80">
                      {fmtAskPct(flow.ask_pct)}
                    </td>
                    <td className="text-right tabular-nums text-sky-300/80">
                      {fmtOi(flow.open_interest)}
                    </td>
                    <td className="text-right tabular-nums text-sky-300/80">
                      {fmtIv(flow.implied_volatility)}
                    </td>
                    <td className="text-right tabular-nums text-sky-300/80">
                      {fmtOtm(flow.otm_pct)}
                    </td>
                    <td>
                      <span className="helix-flow-type font-mono text-[10px] uppercase text-cyan-300/90">
                        {flow.alert_rule ? ruleLabel(flow.alert_rule) : flow.route?.slice(0, 6) || "—"}
                      </span>
                    </td>
                    <td className="text-right tabular-nums text-purple-light/90">
                      {flow.score > 0 ? flow.score.toFixed(1) : "—"}
                    </td>
                    <td>
                      <div className="helix-flow-signals flex flex-wrap gap-0.5">
                        {visibleSignals.map((s) => (
                          <SignalPill key={s.id} label={s.label} tone={s.tone} />
                        ))}
                        {extraSignals > 0 && (
                          <span className="helix-flow-signal helix-flow-signal--muted">+{extraSignals}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
        {hasMore && !loading && (
          <button
            type="button"
            className="helix-flow-load-more"
            onClick={() => setRenderLimit((r) => r + RENDER_LIMIT)}
          >
            Load {Math.min(RENDER_LIMIT, filtered.length - renderLimit)} more ·{" "}
            {filtered.length - renderLimit} remaining
          </button>
        )}
      </div>
    </div>
  );
}
