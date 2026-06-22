"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { DeskPanel } from "./DeskPanel";

const WHALE_PREMIUM = 1_000_000;
const STAGGER = 0.04;
const RENDER_LIMIT = 150; // Bug 8: cap per-render to prevent browser freeze on large datasets

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

// Bug 3: use Intl to derive today's ET date — handles DST (EST -05:00 / EDT -04:00) automatically
function calcDte(expiry: string): number | null {
  if (!expiry) return null;
  const etStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [m, d, y] = etStr.split("/");
  const todayMs = new Date(`${y}-${m}-${d}T00:00:00`).getTime();
  const expMs   = new Date(`${expiry}T00:00:00`).getTime();
  return Math.max(0, Math.floor((expMs - todayMs) / 86_400_000));
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
        <div key={i} className="rounded-lg border border-zinc-800/50 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flow-skeleton h-[18px] rounded" style={{ width: `${w * 0.6}px` }} />
              <div className="flow-skeleton h-[14px] w-10 rounded" />
            </div>
            <div className="flow-skeleton h-[16px] w-16 rounded" />
          </div>
          <div className="flow-skeleton h-[11px] rounded" style={{ width: `${w}%` }} />
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
}) {
  const [renderLimit, setRenderLimit] = useState(RENDER_LIMIT); // Bug 8
  const [newCount, setNewCount]       = useState(0);            // Bug 11
  const scrollRef  = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);

  const feedStatus = loading ? undefined : live ? "live" : "reconnecting";

  const visible = typeFilter === "ALL"
    ? flows
    : flows.filter((f) => f.option_type?.toUpperCase() === typeFilter);

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

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNewCount(0);
  };

  return (
    <DeskPanel
      title={replayMode ? "HELIX · REPLAY" : "HELIX"}
      subtitle={undefined}
      variant="purple"
      feedStatus={replayMode ? undefined : feedStatus}
      glow
      className="h-full"
    >
      <div className="relative">
        {/* Bug 11: new alert badge — floats above scroll area when user is scrolled down */}
        <AnimatePresence>
          {newCount > 0 && (
            <motion.button
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              type="button"
              onClick={scrollToTop}
              className="absolute top-2 left-1/2 -translate-x-1/2 z-10 font-mono text-[10px] font-bold px-3 py-1 rounded-full border border-violet-600/60 bg-violet-950/90 text-violet-300 backdrop-blur-sm whitespace-nowrap"
              style={{ boxShadow: "0 0 12px rgba(139,92,246,0.4)" }}
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
        >
          {loading ? (
            <SkeletonCards />
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-8 h-8 rounded-full border border-zinc-800 flex items-center justify-center">
                <span className="text-cyan-500 text-xs">—</span>
              </div>
              <p className="font-mono text-[11px] text-cyan-400 text-center">
                {tickerFilter
                  ? `No alerts found for ${tickerFilter} — try a different ticker or lower the premium filter`
                  : typeFilter !== "ALL"
                    ? `No ${typeFilter} alerts above the current premium threshold`
                    : hasData
                      ? "Watching for flow alerts…"
                      : live
                        ? "Loading flow data…"
                        : "Reconnecting to flow data…"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 py-1">
              <AnimatePresence initial={false}>
                {displayed.map((flow, i) => {
                  const isCall     = flow.option_type?.toUpperCase() === "CALL";
                  const isWhale    = flow.premium >= WHALE_PREMIUM;
                  const dte        = flow.dte ?? calcDte(flow.expiry);
                  const is0dte     = dte === 0;
                  const isCompound   = compoundTickers?.has(flow.ticker) ?? false;
                  const isDiverge    = (isCall && flow.direction === "bearish") ||
                                       (!isCall && flow.direction === "bullish");
                  const hasSplit     = splitFlowTickers?.has(flow.ticker) ?? false;
                  const earnIn       = earningsDays?.[flow.ticker] ?? null;
                  const hasVelocity  = velocitySpikeTickers?.has(flow.ticker) ?? false;
                  const hasCoord     = coordinatedTickers?.has(flow.ticker) ?? false;
                  const isHawk       = hawkTickers?.has(flow.ticker) ?? false;
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
                    <motion.div
                      key={`${flow.ticker}-${flow.alerted_at}-${i}`}
                      layout="position"
                      initial={{ opacity: 0, x: -12, scale: 0.98 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
                      transition={{
                        opacity:   { duration: 0.25, delay: i < 5 ? i * STAGGER : 0 },
                        x:         { duration: 0.3,  delay: i < 5 ? i * STAGGER : 0, type: "spring", damping: 22, stiffness: 280 },
                        scale:     { duration: 0.25 },
                      }}
                      onClick={() => onTickerClick?.(flow.ticker)}
                      className={cardCls}
                      style={i === 0 ? { animation: "flow-alert-flash 2s ease-out forwards" } : undefined}
                    >
                      {/* Row 1: ticker + badges + premium */}
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          {isCompound && (
                            <span className="flow-badge flow-badge-stack">⚡ STACKING</span>
                          )}
                          <span className="font-anton text-[18px] leading-none text-yellow-300 tracking-wide">
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
                          {isDiverge && <span className="flow-badge flow-badge-diverge">DIVERGE</span>}
                          {hasSplit && (
                            <span
                              className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border"
                              style={{ color: "#f59e0b", borderColor: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", letterSpacing: "0.06em" }}
                            >
                              SPLIT
                            </span>
                          )}
                          {isHawk && (
                            <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border text-indigo-400 border-indigo-700/40 bg-indigo-950/25"
                              style={{ letterSpacing: "0.06em" }}>
                              ◈ HAWK
                            </span>
                          )}
                          {hasVelocity && (
                            <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border text-orange-400 border-orange-700/40 bg-orange-950/25 animate-pulse"
                              style={{ letterSpacing: "0.06em" }}>
                              ◉ VELOCITY
                            </span>
                          )}
                          {hasCoord && (
                            <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border text-cyan-400 border-cyan-700/40 bg-cyan-950/25"
                              style={{ letterSpacing: "0.06em" }}>
                              ⬡ COORD
                            </span>
                          )}
                          {earnIn !== null && earnIn <= 14 && (
                            <span className={clsx(
                              "font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border",
                              earnIn === 0 ? "text-red-400 border-red-700/60 bg-red-950/30 animate-pulse" :
                              earnIn <= 2  ? "text-red-400 border-red-700/50 bg-red-950/20" :
                              earnIn <= 5  ? "text-orange-400 border-orange-700/50 bg-orange-950/20" :
                                             "text-amber-500 border-amber-800/40 bg-amber-950/15"
                            )}>
                              ⚡{earnIn === 0 ? "EARN TODAY" : `EARN ${earnIn}D`}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 ml-auto flex-shrink-0">
                          <span
                            className="font-mono text-[19px] font-black tabular-nums tracking-tight"
                            style={{
                              color: isCompound ? "#fde047"
                                   : isCall     ? "#00ff7f"
                                   :              "#ff2d55",
                              textShadow: isCompound ? "0 0 10px rgba(253,224,71,0.7)"
                                        : isCall     ? "0 0 12px rgba(0,255,127,0.65)"
                                        :              "0 0 12px rgba(255,45,85,0.65)",
                            }}
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
                          <span className="text-yellow-300 font-semibold">{flow.strike}{isCall ? "C" : "P"}</span>
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
                              <span className={flow.ask_pct >= 85 ? "text-amber-400" : "text-sky-300"}>
                                {Math.round(flow.ask_pct)}% ask
                              </span>
                            </>
                          )}
                        </p>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {flow.score > 0 && (
                            <span className={clsx(
                              "font-mono text-[10px] font-medium",
                              flow.score >= 8 ? "text-violet-400" : flow.score >= 6 ? "text-violet-500" : "text-cyan-400"
                            )}>
                              ▲{flow.score.toFixed(1)}
                            </span>
                          )}
                          <span
                            className="font-mono text-[10px] font-black uppercase tracking-wider"
                            style={{
                              color: flow.direction?.toLowerCase() === "bullish" ? "#00ff7f"
                                   : flow.direction?.toLowerCase() === "bearish" ? "#ff2d55"
                                   : isCall ? "#00ff7f" : "#ff2d55",
                              textShadow: flow.direction?.toLowerCase() === "bullish"
                                ? "0 0 8px rgba(0,255,127,0.55)"
                                : "0 0 8px rgba(255,45,85,0.55)",
                            }}
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
                              "font-mono text-[9px] px-1.5 py-0.5 rounded border",
                              flow.otm_pct < 0
                                ? "text-fuchsia-400 border-fuchsia-900/40 bg-fuchsia-950/15"
                                : flow.otm_pct <= 2
                                  ? "text-rose-400 border-rose-900/40 bg-rose-950/15"
                                  : flow.otm_pct <= 8
                                    ? "text-amber-400 border-amber-900/40 bg-amber-950/15"
                                    : "text-emerald-400 border-emerald-900/40 bg-emerald-950/15"
                            )}>
                              {flow.otm_pct < 0
                                ? `${Math.abs(flow.otm_pct).toFixed(1)}% ITM`
                                : `${flow.otm_pct.toFixed(1)}% OTM`}
                            </span>
                          )}
                          {flow.open_interest != null && flow.open_interest > 0 && (
                            <span className="font-mono text-[9px] text-cyan-400 px-1.5 py-0.5 rounded border border-zinc-800/50">
                              OI {flow.open_interest >= 1000
                                ? `${(flow.open_interest / 1000).toFixed(1)}K`
                                : flow.open_interest.toFixed(0)}
                            </span>
                          )}
                          {ivDisplay && (
                            <span className="font-mono text-[9px] text-cyan-400 px-1.5 py-0.5 rounded border border-zinc-800/50">
                              IV {ivDisplay}
                            </span>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* Bug 8: load-more button instead of rendering all 5000 items */}
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setRenderLimit((r) => r + RENDER_LIMIT)}
                  className="w-full font-mono text-[10px] text-cyan-400 hover:text-sky-300 py-3 border border-zinc-800/50 rounded-lg hover:border-zinc-700 transition-colors mt-1"
                >
                  Load {Math.min(RENDER_LIMIT, visible.length - renderLimit)} more · {visible.length - renderLimit} remaining
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </DeskPanel>
  );
}
