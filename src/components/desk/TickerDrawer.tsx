"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { clsx } from "clsx";
import { Drawer } from "@/components/ui";
import { fetchFlows, fetchDarkPoolPrints, fmtPremium, type FlowAlert, type DarkPoolRow } from "@/lib/api";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function fmtExpiry(expiry: string): string {
  if (!expiry) return "";
  const [y, m, d] = expiry.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

type State = { flows: FlowAlert[]; dp: DarkPoolRow[]; loading: boolean };

function FlowRow({ f }: { f: FlowAlert }) {
  const isCall = f.option_type === "CALL";
  const isWhale = f.premium >= 1_000_000;
  return (
    <div className={clsx(
      "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
      isCall
        ? "border-emerald-900/40 bg-emerald-950/10 hover:bg-emerald-950/20"
        : "border-rose-900/40 bg-rose-950/10 hover:bg-rose-950/20"
    )}>
      {/* Left: type + contract */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={clsx("flow-badge", isCall ? "flow-badge-call" : "flow-badge-put")}>
            {f.option_type}
          </span>
          <span className="font-mono text-[11px] text-gold font-medium">{f.strike}{isCall ? "C" : "P"}</span>
          <span className="font-mono text-[10px] text-sky-300">{fmtExpiry(f.expiry)}</span>
          {f.route === "0dte"  && <span className="flow-badge flow-badge-0dte">0DTE</span>}
          {isWhale             && <span className="flow-badge flow-badge-whale">WHALE</span>}
          {f.alert_rule        && <span className="flow-badge flow-badge-sweep">{f.alert_rule.toUpperCase().slice(0,6)}</span>}
        </div>
        <p className="font-mono text-[9px] text-cyan-500 mt-1">{timeAgo(f.alerted_at)}</p>
      </div>

      {/* Right: premium + score */}
      <div className="text-right flex-shrink-0">
        <p className={clsx("font-mono text-[13px] font-bold tabular-nums", isCall ? "text-emerald-400" : "text-rose-400")}>
          {fmtPremium(f.premium)}
        </p>
        {f.score > 0 && (
          <p className={clsx("font-mono text-[9px]", f.score >= 7 ? "text-violet-500" : "text-cyan-500")}>
            ▲{f.score.toFixed(1)}
          </p>
        )}
      </div>
    </div>
  );
}

// Bug 13: typeFilter syncs TickerDrawer with the tape's active filter
export function TickerDrawer({
  ticker,
  typeFilter,
  onClose,
  isStarred,
  onToggleStar,
}: {
  ticker: string | null;
  typeFilter?: "ALL" | "CALL" | "PUT";
  onClose: () => void;
  isStarred?: boolean;
  onToggleStar?: (ticker: string) => void;
}) {
  const [state, setState] = useState<State>({ flows: [], dp: [], loading: false });

  const load = useCallback(async (t: string) => {
    setState({ flows: [], dp: [], loading: true });
    const [fr, dr] = await Promise.allSettled([
      fetchFlows({ limit: 40, ticker: t }),
      fetchDarkPoolPrints({ limit: 20 }),
    ]);
    const flows = fr.status === "fulfilled" ? fr.value.flows : [];
    const dp    = dr.status === "fulfilled" ? dr.value.prints.filter((p) => p.ticker === t) : [];
    setState({ flows, dp, loading: false });
  }, []);

  useEffect(() => {
    if (ticker) load(ticker);
    else setState({ flows: [], dp: [], loading: false });
  }, [ticker, load]);

  // Apply same typeFilter as the tape so drawer matches what the user is looking at
  const displayFlows = typeFilter && typeFilter !== "ALL"
    ? state.flows.filter((f) => f.option_type === typeFilter)
    : state.flows;

  const callPrem = displayFlows.filter((f) => f.option_type === "CALL").reduce((s, f) => s + f.premium, 0);
  const putPrem  = displayFlows.filter((f) => f.option_type === "PUT").reduce((s, f) => s + f.premium, 0);
  const total    = callPrem + putPrem;
  const callPct  = total > 0 ? Math.round((callPrem / total) * 100) : 0;
  const isBull   = callPrem >= putPrem;

  const header = (
    <div className="flex items-center gap-3">
      {onToggleStar && ticker && (
        <button
          type="button"
          onClick={() => onToggleStar(ticker)}
          title={isStarred ? `Remove ${ticker} from watchlist` : `Add ${ticker} to watchlist`}
          aria-pressed={!!isStarred}
          className={clsx(
            "leading-none text-[22px] transition-colors",
            isStarred ? "text-gold" : "text-cyan-400 hover:text-gold"
          )}
        >
          {isStarred ? "★" : "☆"}
        </button>
      )}
      <span className="font-anton text-[28px] text-white leading-none tracking-wide">{ticker}</span>
      {!state.loading && state.flows.length > 0 && (
        <div className={clsx(
          "px-2 py-1 rounded-md border font-mono text-[10px] font-semibold",
          isBull ? "border-emerald-800 text-emerald-300 bg-emerald-950" : "border-rose-800 text-rose-300 bg-rose-950"
        )}>
          {isBull ? "↑" : "↓"} {callPct}% calls
        </div>
      )}
    </div>
  );

  return (
    <Drawer
      open={!!ticker}
      onClose={onClose}
      side="right"
      title={header}
    >
      {/* Content */}
      <div className="flow-scroll">
        {state.loading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flow-skeleton h-16 rounded-lg" />
              <div className="flow-skeleton h-16 rounded-lg" />
            </div>
            {[1, 2, 3, 4].map((n) => <div key={n} className="flow-skeleton h-14 rounded-lg" />)}
          </div>
        ) : (
          <div className="space-y-5">
                  {/* Premium summary */}
                  {displayFlows.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-3">
                        <p className="font-mono text-[9px] tracking-widest text-emerald-800 uppercase mb-1.5">Call Premium</p>
                        <p className="font-mono text-lg font-bold text-emerald-400 tabular-nums">{fmtPremium(callPrem)}</p>
                        <p className="font-mono text-[9px] text-emerald-800 mt-0.5">{callPct}% of flow</p>
                      </div>
                      <div className="rounded-lg border border-rose-900/40 bg-rose-950/15 p-3">
                        <p className="font-mono text-[9px] tracking-widest text-rose-800 uppercase mb-1.5">Put Premium</p>
                        <p className="font-mono text-lg font-bold text-rose-400 tabular-nums">{fmtPremium(putPrem)}</p>
                        <p className="font-mono text-[9px] text-rose-800 mt-0.5">{100 - callPct}% of flow</p>
                      </div>
                    </div>
                  )}

                  {/* Call/put bar */}
                  {total > 0 && (
                    <div>
                      <div className="h-1.5 rounded-full overflow-hidden bg-zinc-900 flex">
                        <motion.div
                          className="h-full bg-gradient-to-r from-[#0f9d58] to-bull"
                          initial={{ width: 0 }}
                          animate={{ width: `${callPct}%` }}
                          transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
                        />
                        <motion.div
                          className="h-full bg-gradient-to-r from-rose-700 to-rose-500 flex-1"
                          initial={{ width: 0 }}
                          animate={{ width: `${100 - callPct}%` }}
                          transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1], delay: 0.05 }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Flow alerts */}
                  <div>
                    <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-cyan-500 mb-2">
                      Flow · {displayFlows.length} alerts{typeFilter && typeFilter !== "ALL" ? ` · ${typeFilter}` : ""}
                    </p>
                    {displayFlows.length === 0 ? (
                      <p className="font-mono text-[11px] text-cyan-500 text-center py-6">No {typeFilter && typeFilter !== "ALL" ? typeFilter.toLowerCase() + " " : ""}flow alerts for {ticker}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {displayFlows.map((f, i) => <FlowRow key={`${f.alerted_at}-${i}`} f={f} />)}
                      </div>
                    )}
                  </div>

                  {/* Dark pool */}
                  {state.dp.length > 0 && (
                    <div>
                      <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-cyan-500 mb-2">
                        Dark Pool · {state.dp.length} prints
                      </p>
                      <div className="space-y-1.5">
                        {state.dp.map((p, i) => (
                          <div
                            key={`dp-${i}`}
                            className={clsx(
                              "flex items-center justify-between rounded-lg border px-3 py-2",
                              p.side === "buy"  ? "border-emerald-900/30 bg-emerald-950/10" :
                              p.side === "sell" ? "border-rose-900/30 bg-rose-950/10" :
                              "border-zinc-800 bg-zinc-900/30"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className={clsx(
                                "font-mono text-[10px] font-bold",
                                p.side === "buy" ? "text-emerald-400" : p.side === "sell" ? "text-rose-400" : "text-cyan-400"
                              )}>
                                {p.side === "buy" ? "↑ BUY" : p.side === "sell" ? "↓ SELL" : "— DARK"}
                              </span>
                              <span className="font-mono text-[9px] text-cyan-500">{timeAgo(p.executed_at)}</span>
                            </div>
                            <span className={clsx(
                              "font-mono text-[13px] font-bold tabular-nums",
                              p.side === "buy" ? "text-emerald-400" : p.side === "sell" ? "text-rose-400" : "text-sky-200"
                            )}>
                              {fmtPremium(p.premium)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
