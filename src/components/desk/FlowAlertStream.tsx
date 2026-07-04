"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { daysToExpiry } from "@/lib/nights-watch/valuation";
import { Panel, Skeleton, EmptyState } from "@/components/ui";

const WHALE_PREMIUM = 1_000_000;
const RENDER_LIMIT = 150; // Bug 8: cap per-render to prevent browser freeze on large datasets

function timeAgo(iso: string): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "0s";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function fmtExpiry(expiry: string): string {
  if (!expiry) return "";
  const [y, m, d] = expiry.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

function ruleLabel(rule: string): string {
  const r = rule.toLowerCase();
  if (r.includes("repeated")) return "REPEAT";
  if (r.includes("sweep"))    return "SWEEP";
  if (r.includes("floor"))    return "FLOOR";
  if (r.includes("grenade"))  return "GRENADE";
  if (r.includes("block"))    return "BLOCK";
  return rule.toUpperCase().slice(0, 8);
}

function ruleBadgeCls(rule: string): string {
  const r = rule.toLowerCase();
  if (r.includes("sweep"))   return "flow-badge flow-badge-sweep";
  if (r.includes("floor"))   return "flow-badge flow-badge-floor";
  if (r.includes("grenade")) return "flow-badge flow-badge-grenade";
  if (r.includes("block"))   return "flow-badge flow-badge-block";
  if (r.includes("repeat"))  return "flow-badge flow-badge-repeat";
  return "flow-badge flow-badge-whale";
}

function SkeletonCards() {
  return (
    <div className="flex flex-col gap-2 px-1">
      {[80, 65, 90, 55, 75].map((w, i) => (
        <div key={i} className="rounded-lg border border-white/10 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton width={w * 0.6} height={18} rounded="sm" />
              <Skeleton width={40} height={14} rounded="sm" />
            </div>
            <Skeleton width={64} height={16} rounded="sm" />
          </div>
          <Skeleton width={`${w}%`} height={11} rounded="sm" />
        </div>
      ))}
    </div>
  );
}

export function FlowAlertStream({
  flows,
  live,
  loading,
  typeFilter = "ALL",
  tickerFilter,
  hasData = false,
  compoundTickers,
  onTickerClick,
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
  replayMode?: boolean;
  splitFlowTickers?: Set<string>;
  earningsDays?: Record<string, number>;
  velocitySpikeTickers?: Set<string>;
  coordinatedTickers?: Set<string>;
  hawkTickers?: Set<string>;
  watchlistTickers?: Set<string>;
  onToggleStar?: (ticker: string) => void;
}) {
  const [renderLimit, setRenderLimit] = useState(RENDER_LIMIT); // Bug 8
  const [newCount, setNewCount]       = useState(0);            // Bug 11
  const [, setAgeTick] = useState(0);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setAgeTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  // Parser-truth (gap #6): typeless UW prints carry option_type='UNKNOWN'. They must NOT
  // render as red PUT cards (the else-branch in cardCls / premium color), so DROP them from
  // the tape entirely — mirroring the SPX-tape drop. Only real CALL/PUT prints reach a card.
  const typed = flows.filter((f) => {
    const t = f.option_type?.toUpperCase();
    return t === "CALL" || t === "PUT";
  });
  const visible = typeFilter === "ALL"
    ? typed
    : typed.filter((f) => f.option_type?.toUpperCase() === typeFilter);

  // Bug 11: detect new alerts while user is scrolled down and show badge
  useEffect(() => {
    const added = visible.length - prevLenRef.current;
    if (added > 0) {
      const el = scrollRef.current;
      if (el && el.scrollTop > 80) {
        setNewCount((c) => c + added);
      }
    } else if (added < 0) {
      // data was reset (filter/ticker change) — reset state
      setNewCount(0);
      setRenderLimit(RENDER_LIMIT);
    }
    prevLenRef.current = visible.length;
  }, [visible.length]);

  const displayed = visible.slice(0, renderLimit); // Bug 8
  const hasMore   = visible.length > renderLimit;

  // Distinct error/offline state: the fetch dropped (not live) and we're no
  // longer loading. Shown as a bear-accent banner so a feed FAILURE reads
  // differently from a genuinely-empty (but connected) tape. Any stale data
  // already loaded stays rendered below — we never blank good data on error.
  const feedDown = !loading && !replayMode && !live;

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNewCount(0);
  };

  return (
    <Panel
      title={replayMode ? "HELIX · Replay" : "HELIX"}
      accent="accent"
      strip={false}
      className="h-full !rounded-2xl"
      bodyClassName="!p-0"
    >
      <div className="relative">
        {/* Distinct fetch-failure banner — bear accent, role=alert. Sits above the
            tape so it surfaces even while stale prints stay rendered below. */}
        <AnimatePresence>
          {feedDown && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              role="alert"
              className="mx-1 mb-2 flex items-center gap-2 rounded-lg border border-bear/40 bg-bear/[0.08] px-3 py-2"
              style={{ boxShadow: "inset 0 0 14px rgba(255,45,85,0.06)" }}
            >
              <span className="text-bear text-[12px] leading-none">⚠</span>
              <span className="font-mono text-[11px] font-bold text-bear tracking-wide">
                Feed unavailable — retrying
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bug 11: new alert badge — floats above scroll area when user is scrolled down */}
        <AnimatePresence>
          {newCount > 0 && (
            <motion.button
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              type="button"
              onClick={scrollToTop}
              className="absolute top-2 left-1/2 -translate-x-1/2 z-10 font-mono text-[10px] font-bold px-3 py-1 rounded-full border border-purple/60 bg-[rgba(8,9,14,0.9)] text-purple-light backdrop-blur-sm whitespace-nowrap"
              style={{ boxShadow: "0 0 12px rgba(191,95,255,0.4)" }}
            >
              ↑ {newCount} new
            </motion.button>
          )}
        </AnimatePresence>

        <div
          ref={scrollRef}
          className="flow-scroll overflow-y-auto px-1"
          style={{ maxHeight: "calc(100vh - 210px)" }}
          onScroll={() => { if (scrollRef.current && scrollRef.current.scrollTop < 40) setNewCount(0); }}
          role="log"
          aria-live="polite"
          aria-label="Live options flow tape"
        >
          {loading ? (
            <SkeletonCards />
          ) : visible.length === 0 ? (
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
                tickerFilter
                  ? "Widen the ticker or lower the premium floor"
                  : typeFilter !== "ALL"
                    ? "Nothing above the premium floor — lower it to see more"
                    : hasData
                      ? "Tape live — watching for the next print…"
                      : live
                        ? "Acquiring the tape…"
                        : "Reconnecting to the tape…"
              }
            />
          ) : (
            <div className="flex flex-col gap-1.5 py-1">
                {displayed.map((flow, i) => {
                  const isCall     = flow.option_type?.toUpperCase() === "CALL";
                  const isWhale    = flow.premium >= WHALE_PREMIUM;
                  const dte        = flow.dte ?? daysToExpiry(flow.expiry);
                  const is0dte     = dte === 0;
                  const isCompound   = compoundTickers?.has(flow.ticker) ?? false;
                  // (DIVERGE badge removed: `direction` is DERIVED from option_type in both the
                  // SQL and parseUwFlowAlert — call→bullish / put→bearish, always — so the
                  // "call-but-bearish" condition was structurally impossible (0/500 live rows).
                  // A real divergence read needs ask/bid-side data, which UW's WS flow_alerts
                  // payload does not carry; reinstate only if that signal becomes available.)
                  const hasSplit     = splitFlowTickers?.has(flow.ticker) ?? false;
                  const earnIn       = earningsDays?.[flow.ticker] ?? null;
                  const hasVelocity  = velocitySpikeTickers?.has(flow.ticker) ?? false;
                  const hasCoord     = coordinatedTickers?.has(flow.ticker) ?? false;
                  const isHawk       = hawkTickers?.has(flow.ticker) ?? false;
                  const isStarred    = watchlistTickers?.has(flow.ticker) ?? false;
                  // IV display: if < 3 treat as decimal (0.45 → 45%), else as already pct
                  const ivDisplay  = flow.implied_volatility != null && flow.implied_volatility > 0
                    ? flow.implied_volatility < 3
                      ? `${(flow.implied_volatility * 100).toFixed(0)}%`
                      : `${flow.implied_volatility.toFixed(0)}%`
                    : null;

                  const cardCls = clsx(
                    "flow-card",
                    isCompound ? "flow-card-compound" : isCall ? "flow-card-call" : "flow-card-put"
                  );

                  return (
                    <div
                      key={`${flow.ticker}-${flow.alerted_at}-${i}`}
                      onClick={() => onTickerClick?.(flow.ticker)}
                      // I-04 a11y: the tape card is the flagship drill-down; make it keyboard- +
                      // screen-reader-reachable (Enter/Space activate the same open), mirroring
                      // NightsWatchPanel's PositionCard. Interactive role only when it's clickable.
                      onKeyDown={
                        onTickerClick
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onTickerClick(flow.ticker);
                              }
                            }
                          : undefined
                      }
                      role={onTickerClick ? "button" : undefined}
                      tabIndex={onTickerClick ? 0 : undefined}
                      aria-label={onTickerClick ? `Open ${flow.ticker} flow detail` : undefined}
                      className={cardCls}
                      style={i === 0 ? { animation: "flow-alert-flash 2s ease-out forwards" } : undefined}
                    >
                      {/* Row 1: ticker + badges + premium */}
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          {isCompound && (
                            <span className="flow-badge flow-badge-stack">⚡ STACKING</span>
                          )}
                          {onToggleStar && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onToggleStar(flow.ticker); }}
                              title={isStarred ? `Remove ${flow.ticker} from watchlist` : `Add ${flow.ticker} to watchlist`}
                              aria-pressed={isStarred}
                              className={clsx(
                                "leading-none text-[14px] transition-colors",
                                isStarred ? "text-gold" : "text-cyan-400 hover:text-gold"
                              )}
                            >
                              {isStarred ? "★" : "☆"}
                            </button>
                          )}
                          <span className="font-anton text-[24px] leading-none text-gold tracking-wide">
                            {flow.ticker}
                          </span>
                          <span className={clsx("flow-badge", isCall ? "flow-badge-call" : "flow-badge-put")}>
                            {flow.option_type?.toUpperCase()}
                          </span>
                          {flow.alert_rule && (
                            <span className={ruleBadgeCls(flow.alert_rule)}>
                              {ruleLabel(flow.alert_rule)}
                            </span>
                          )}
                          {isWhale && <span className="flow-badge flow-badge-whale">WHALE</span>}
                          {is0dte && <span className="flow-badge flow-badge-0dte">0DTE</span>}
                          {hasSplit && (
                            <span
                              className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border"
                              style={{ color: "#ffd23f", borderColor: "rgba(255,210,63,0.4)", background: "rgba(255,210,63,0.08)", letterSpacing: "0.06em" }}
                            >
                              SPLIT
                            </span>
                          )}
                          {isHawk && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border text-sky-300 border-sky-400/40 bg-sky-400/10"
                              style={{ letterSpacing: "0.06em" }}>
                              ◈ HAWK
                            </span>
                          )}
                          {hasVelocity && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border text-ember border-ember/40 bg-ember/10 animate-pulse motion-reduce:animate-none"
                              style={{ letterSpacing: "0.06em" }}>
                              ◉ VELOCITY
                            </span>
                          )}
                          {hasCoord && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border text-cyan-400 border-cyan-700/40 bg-cyan-950/25"
                              style={{ letterSpacing: "0.06em" }}>
                              ⬡ COORD
                            </span>
                          )}
                          {flow.gex_proximity === "at_gamma_flip" && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border text-purple-light border-purple/50 bg-purple/10"
                              style={{ letterSpacing: "0.06em" }}>
                              ◈ FLIP
                            </span>
                          )}
                          {flow.gex_proximity === "at_call_wall" && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border"
                              style={{ color: "#00e676", borderColor: "rgba(0,230,118,0.45)", background: "rgba(0,230,118,0.08)", letterSpacing: "0.06em" }}>
                              ▲ CALL WALL
                            </span>
                          )}
                          {flow.gex_proximity === "at_put_wall" && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border"
                              style={{ color: "#ff2d55", borderColor: "rgba(255,45,85,0.45)", background: "rgba(255,45,85,0.08)", letterSpacing: "0.06em" }}>
                              ▼ PUT WALL
                            </span>
                          )}
                          {flow.gex_proximity === "near_call_wall" && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border"
                              style={{ color: "rgba(0,230,118,0.7)", borderColor: "rgba(0,230,118,0.25)", background: "rgba(0,230,118,0.05)", letterSpacing: "0.06em" }}>
                              ~ CALL WALL
                            </span>
                          )}
                          {flow.gex_proximity === "near_put_wall" && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border"
                              style={{ color: "rgba(255,45,85,0.7)", borderColor: "rgba(255,45,85,0.25)", background: "rgba(255,45,85,0.05)", letterSpacing: "0.06em" }}>
                              ~ PUT WALL
                            </span>
                          )}
                          {earnIn !== null && earnIn <= 14 && (
                            <span className={clsx(
                              "font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border",
                              earnIn === 0 ? "text-bear border-bear/60 bg-bear/15 animate-pulse motion-reduce:animate-none" :
                              earnIn <= 2  ? "text-bear border-bear/50 bg-bear/10" :
                              earnIn <= 5  ? "text-ember border-ember/50 bg-ember/10" :
                                             "text-gold border-gold/40 bg-gold/10"
                            )}>
                              ⚡{earnIn === 0 ? "EARN TODAY" : `EARN ${earnIn}D`}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 ml-auto flex-shrink-0">
                          <span
                            className={clsx(
                              "t-num text-[19px] font-bold tabular-nums tracking-tight",
                              isCompound ? "text-gold" : isCall ? "text-bull" : "text-bear-text"
                            )}
                          >
                            {fmtPremium(flow.premium)}
                          </span>
                          <span className="font-mono text-[10px] text-sky-300 w-6 text-right tabular-nums">
                            {timeAgo(flow.alerted_at)}
                          </span>
                        </div>
                      </div>

                      {/* Row 2: contract details */}
                      <div className="flex items-center justify-between mt-1.5 gap-2">
                        <p className="font-mono text-[11px] text-sky-300 leading-none flex items-center gap-1 flex-wrap">
                          <span className="text-gold font-semibold">{flow.strike}{isCall ? "C" : "P"}</span>
                          <span className="text-cyan-400">·</span>
                          <span>{fmtExpiry(flow.expiry)}</span>
                          {dte !== null && !is0dte && (
                            <>
                              <span className="text-cyan-400">·</span>
                              <span>{dte}d</span>
                            </>
                          )}
                          {flow.ask_pct != null && flow.ask_pct > 0 && (
                            <>
                              <span className="text-cyan-400">·</span>
                              <span className={flow.ask_pct >= 85 ? "text-gold" : "text-sky-300"}>
                                {Math.round(flow.ask_pct)}% ask
                              </span>
                            </>
                          )}
                        </p>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {flow.score > 0 && (
                            <span className={clsx(
                              "font-mono text-[10px] font-medium",
                              flow.score >= 8 ? "text-purple-light" : flow.score >= 6 ? "text-purple" : "text-cyan-400"
                            )}>
                              ▲{flow.score.toFixed(1)}
                            </span>
                          )}
                          <span
                            className={clsx(
                              "t-num text-[10px] font-semibold uppercase tracking-wider",
                              flow.direction?.toLowerCase() === "bullish"
                                ? "text-bull"
                                : flow.direction?.toLowerCase() === "bearish"
                                  ? "text-bear-text"
                                  : isCall
                                    ? "text-bull"
                                    : "text-bear-text"
                            )}
                          >
                            {flow.direction}
                          </span>
                        </div>
                      </div>

                      {/* Row 3: Options chain context (Feature 5) */}
                      {(flow.otm_pct !== undefined || (flow.open_interest != null && flow.open_interest > 0) || ivDisplay) && (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {flow.otm_pct !== undefined && (
                            <span className={clsx(
                              "font-mono text-[10px] px-1.5 py-0.5 rounded border",
                              flow.otm_pct < 0
                                ? "text-purple-light border-purple/40 bg-purple/10"
                                : flow.otm_pct <= 2
                                  ? "text-bear border-bear/40 bg-bear/10"
                                  : flow.otm_pct <= 8
                                    ? "text-gold border-gold/40 bg-gold/10"
                                    : "text-bull border-bull/40 bg-bull/10"
                            )}>
                              {flow.otm_pct < 0
                                ? `${Math.abs(flow.otm_pct).toFixed(1)}% ITM`
                                : `${flow.otm_pct.toFixed(1)}% OTM`}
                            </span>
                          )}
                          {flow.open_interest != null && flow.open_interest > 0 && (
                            <span className="font-mono text-[10px] text-cyan-400 px-1.5 py-0.5 rounded border border-white/10">
                              OI {flow.open_interest >= 1000
                                ? `${(flow.open_interest / 1000).toFixed(1)}K`
                                : flow.open_interest.toFixed(0)}
                            </span>
                          )}
                          {ivDisplay && (
                            <span className="font-mono text-[10px] text-cyan-400 px-1.5 py-0.5 rounded border border-white/10">
                              IV {ivDisplay}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

              {/* Bug 8: load-more button instead of rendering all 5000 items */}
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setRenderLimit((r) => r + RENDER_LIMIT)}
                  className="w-full font-mono text-[10px] text-cyan-400 hover:text-sky-300 py-3 border border-white/10 rounded-lg hover:border-white/20 transition-colors mt-1"
                >
                  Load {Math.min(RENDER_LIMIT, visible.length - renderLimit)} more · {visible.length - renderLimit} remaining
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
