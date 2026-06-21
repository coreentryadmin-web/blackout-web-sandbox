"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { DeskPanel } from "./DeskPanel";

const WHALE_PREMIUM = 1_000_000;
const STAGGER = 0.04;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function calcDte(expiry: string): number | null {
  if (!expiry) return null;
  const exp = new Date(expiry + "T16:00:00-05:00");
  return Math.max(0, Math.floor((exp.getTime() - Date.now()) / 86_400_000));
}

function fmtExpiry(expiry: string): string {
  if (!expiry) return "";
  const [, m, d] = expiry.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(d)}`;
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
  compoundTickers,
  onTickerClick,
  replayMode = false,
}: {
  flows: FlowAlert[];
  live?: boolean;
  loading?: boolean;
  typeFilter?: "ALL" | "CALL" | "PUT";
  compoundTickers?: Set<string>;
  onTickerClick?: (ticker: string) => void;
  replayMode?: boolean;
}) {
  const feedStatus = loading ? undefined : live ? "live" : "reconnecting";

  const visible = typeFilter === "ALL"
    ? flows
    : flows.filter((f) => f.option_type?.toUpperCase() === typeFilter);

  return (
    <DeskPanel
      title={replayMode ? "Flow Tape · REPLAY" : "Flow Tape"}
      subtitle={`Unusual Whales · live sweep${visible.length > 0 ? ` · ${visible.length} alerts` : ""}`}
      variant="purple"
      feedStatus={replayMode ? undefined : feedStatus}
      glow
      className="h-full"
    >
      <div
        className="flow-scroll overflow-y-auto px-1"
        style={{ maxHeight: "calc(100vh - 210px)" }}
      >
        {loading ? (
          <SkeletonCards />
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-8 h-8 rounded-full border border-zinc-800 flex items-center justify-center">
              <span className="text-zinc-700 text-xs">—</span>
            </div>
            <p className="font-mono text-[11px] text-zinc-600 text-center">
              {live
                ? typeFilter !== "ALL"
                  ? `No ${typeFilter} alerts matching filters`
                  : "Watching for flow alerts…"
                : "Connect UW_API_KEY to see live flow"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 py-1">
            <AnimatePresence initial={false}>
              {visible.map((flow, i) => {
                const isCall     = flow.option_type?.toUpperCase() === "CALL";
                const isWhale    = flow.premium >= WHALE_PREMIUM;
                const dte        = flow.dte ?? calcDte(flow.expiry);
                const is0dte     = dte === 0;
                const isCompound = compoundTickers?.has(flow.ticker) ?? false;
                const isDiverge  = (isCall && flow.direction === "bearish") ||
                                   (!isCall && flow.direction === "bullish");

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
                        {/* Compound badge first */}
                        {isCompound && (
                          <span className="flow-badge flow-badge-stack">⚡ STACKING</span>
                        )}

                        {/* Ticker */}
                        <span className="font-anton text-[18px] leading-none text-white tracking-wide">
                          {flow.ticker}
                        </span>

                        {/* Call / Put */}
                        <span className={clsx("flow-badge", isCall ? "flow-badge-call" : "flow-badge-put")}>
                          {flow.option_type?.toUpperCase()}
                        </span>

                        {/* Alert rule */}
                        {flow.alert_rule && (
                          <span className={ruleBadgeCls(flow.alert_rule)}>
                            {ruleLabel(flow.alert_rule)}
                          </span>
                        )}

                        {/* Whale badge */}
                        {isWhale && <span className="flow-badge flow-badge-whale">WHALE</span>}

                        {/* 0DTE badge */}
                        {is0dte && <span className="flow-badge flow-badge-0dte">0DTE</span>}

                        {/* Divergence badge */}
                        {isDiverge && <span className="flow-badge flow-badge-diverge">DIVERGE</span>}
                      </div>

                      {/* Premium + time */}
                      <div className="flex items-center gap-3 ml-auto flex-shrink-0">
                        <span className={clsx(
                          "font-mono text-[15px] font-bold tabular-nums tracking-tight",
                          isCompound ? "text-amber-400" : isCall ? "text-emerald-400" : "text-rose-400"
                        )}>
                          {fmtPremium(flow.premium)}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-600 w-6 text-right tabular-nums">
                          {timeAgo(flow.alerted_at)}
                        </span>
                      </div>
                    </div>

                    {/* Row 2: contract details */}
                    <div className="flex items-center justify-between mt-1.5 gap-2">
                      <p className="font-mono text-[11px] text-zinc-500 leading-none flex items-center gap-1 flex-wrap">
                        <span className="text-zinc-300 font-medium">${flow.strike}</span>
                        <span className="text-zinc-700">·</span>
                        <span>{fmtExpiry(flow.expiry)}</span>
                        {dte !== null && !is0dte && (
                          <>
                            <span className="text-zinc-700">·</span>
                            <span>{dte}d</span>
                          </>
                        )}
                        {flow.ask_pct != null && flow.ask_pct > 0 && (
                          <>
                            <span className="text-zinc-700">·</span>
                            <span className={flow.ask_pct >= 85 ? "text-amber-500" : "text-zinc-500"}>
                              {Math.round(flow.ask_pct)}% ask
                            </span>
                          </>
                        )}
                      </p>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {flow.score > 0 && (
                          <span className={clsx(
                            "font-mono text-[10px] font-medium",
                            flow.score >= 8 ? "text-violet-400" : flow.score >= 6 ? "text-violet-600" : "text-zinc-600"
                          )}>
                            ▲{flow.score.toFixed(1)}
                          </span>
                        )}
                        <span className={clsx(
                          "font-mono text-[9px] uppercase tracking-wider",
                          isCall ? "text-emerald-900" : "text-rose-900"
                        )}>
                          {flow.direction}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </DeskPanel>
  );
}
