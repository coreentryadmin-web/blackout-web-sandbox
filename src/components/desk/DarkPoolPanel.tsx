"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AreaChart, Area, ResponsiveContainer, ReferenceLine } from "recharts";
import { clsx } from "clsx";
import {
  fmtPremium,
  fetchDarkPoolPrints,
  fetchDarkPoolTicker,
  type DarkPoolRow,
  type DarkPoolTickerSnapshot,
} from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TICKER_TABS = ["MARKET", "SPY", "QQQ", "SPX"] as const;
type Tab = (typeof TICKER_TABS)[number];
const MIN_FILTERS = [0, 250_000, 500_000, 1_000_000] as const;
const POLL_MS = 30_000;
const MAX_HISTORY = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function fmtShares(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function biasFromSide(prints: DarkPoolRow[]) {
  const buy  = prints.filter((p) => p.side === "buy").reduce((s, p) => s + p.premium, 0);
  const sell = prints.filter((p) => p.side === "sell").reduce((s, p) => s + p.premium, 0);
  const total = buy + sell;
  if (total <= 0) return { label: "MIXED", color: "text-zinc-500", bg: "bg-zinc-800" };
  const r = buy / total;
  if (r >= 0.65) return { label: "BULLISH", color: "text-emerald-400", bg: "bg-emerald-950" };
  if (r <= 0.35) return { label: "BEARISH", color: "text-rose-400",    bg: "bg-rose-950"   };
  return { label: "MIXED", color: "text-zinc-400", bg: "bg-zinc-800" };
}

function biasFromSnapshot(snap: DarkPoolTickerSnapshot) {
  const b = snap.bias.toLowerCase();
  if (b === "bullish") return { label: "BULLISH", color: "text-emerald-400", bg: "bg-emerald-950" };
  if (b === "bearish") return { label: "BEARISH", color: "text-rose-400",    bg: "bg-rose-950"   };
  return { label: "MIXED", color: "text-zinc-400", bg: "bg-zinc-800" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Tab — market-wide prints + net history sparkline
// ─────────────────────────────────────────────────────────────────────────────

function MarketTab({ minPremium }: { minPremium: number }) {
  const [prints, setPrints]   = useState<DarkPoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<{ t: number; net: number }[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetchDarkPoolPrints({ limit: 60 });
      const rows = res.prints ?? [];
      setPrints(rows);
      const buy  = rows.filter((p) => p.side === "buy").reduce((s, p) => s + p.premium, 0);
      const sell = rows.filter((p) => p.side === "sell").reduce((s, p) => s + p.premium, 0);
      setHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), { t: Date.now(), net: buy - sell }]);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const visible  = minPremium > 0 ? prints.filter((p) => p.premium >= minPremium) : prints;
  const bias     = biasFromSide(visible);
  const latestNet = history[history.length - 1]?.net ?? 0;
  const isBull    = latestNet >= 0;
  const sparkColor = isBull ? "#10b981" : "#f43f5e";

  return (
    <div className="space-y-2">
      {/* Bias + sparkline row */}
      {!loading && visible.length > 0 && (
        <div className="flex items-center gap-3 px-1">
          <span className={clsx("font-mono text-[10px] font-semibold px-2 py-0.5 rounded", bias.bg, bias.color)}>
            {bias.label}
          </span>
          {history.length >= 3 && (
            <div className="flex-1 h-6">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="dpSparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={sparkColor} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={sparkColor} stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <ReferenceLine y={0} stroke="#3f3f46" strokeWidth={1} />
                  <Area type="monotone" dataKey="net" stroke={sparkColor} strokeWidth={1.5}
                    fill="url(#dpSparkGrad)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <span className={clsx("font-mono text-[10px] font-semibold tabular-nums", isBull ? "text-emerald-400" : "text-rose-400")}>
            {isBull ? "+" : ""}{fmtPremium(latestNet)}
          </span>
        </div>
      )}

      {/* Prints list */}
      <div className="flow-scroll overflow-y-auto" style={{ maxHeight: 240 }}>
        {loading ? (
          <div className="space-y-1.5">
            {[1, 2, 3, 4].map((n) => <div key={n} className="flow-skeleton h-10 rounded-md" />)}
          </div>
        ) : visible.length === 0 ? (
          <p className="font-mono text-[10px] text-zinc-700 text-center py-6">
            No prints above threshold
          </p>
        ) : (
          <AnimatePresence initial={false}>
            <div className="space-y-1">
              {visible.map((p, i) => {
                const isBuy  = p.side === "buy";
                const isSell = p.side === "sell";
                return (
                  <motion.div
                    key={`${p.ticker}-${p.executed_at}-${i}`}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.025, duration: 0.18 }}
                    className={clsx(
                      "flex items-center gap-2 rounded-lg px-2.5 py-2 border transition-colors",
                      isBuy  ? "border-emerald-900/30 bg-emerald-950/10 hover:bg-emerald-950/20" :
                      isSell ? "border-rose-900/30 bg-rose-950/10 hover:bg-rose-950/20" :
                               "border-zinc-800/50 bg-zinc-900/20 hover:bg-zinc-900/40"
                    )}
                  >
                    <span className={clsx(
                      "font-mono text-[9px] font-bold w-6 flex-shrink-0",
                      isBuy ? "text-emerald-400" : isSell ? "text-rose-400" : "text-zinc-600"
                    )}>
                      {isBuy ? "↑" : isSell ? "↓" : "—"}
                    </span>
                    <span className="font-anton text-[13px] text-white leading-none flex-shrink-0">{p.ticker}</span>
                    {p.share_size != null && p.share_size > 0 && (
                      <span className="font-mono text-[9px] text-zinc-700 flex-shrink-0">
                        {fmtShares(p.share_size)}sh
                      </span>
                    )}
                    <span className={clsx(
                      "font-mono text-[12px] font-bold tabular-nums ml-auto",
                      isBuy ? "text-emerald-400" : isSell ? "text-rose-400" : "text-zinc-300"
                    )}>
                      {fmtPremium(p.premium)}
                    </span>
                    <span className="font-mono text-[9px] text-zinc-700 flex-shrink-0 w-5 text-right">
                      {timeAgo(p.executed_at)}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticker Tab — per-ticker call/put breakdown + institutional prints by strike
// ─────────────────────────────────────────────────────────────────────────────

function TickerTab({ symbol }: { symbol: string }) {
  const [snap, setSnap]       = useState<DarkPoolTickerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const histRef = useRef<{ t: number; net: number }[]>([]);
  const [history, setHistory] = useState<{ t: number; net: number }[]>([]);

  // Bug 5: cancellation flag prevents stale in-flight fetch from updating state after symbol switch
  useEffect(() => {
    let cancelled = false;

    const doLoad = async () => {
      try {
        const res = await fetchDarkPoolTicker(symbol);
        if (cancelled) return;
        const s = res.snapshot;
        setSnap(s);
        if (s) {
          const net = s.call_premium - s.put_premium;
          histRef.current = [...histRef.current.slice(-(MAX_HISTORY - 1)), { t: Date.now(), net }];
          setHistory([...histRef.current]);
        }
      } catch { /* silently ignore */ }
      finally { if (!cancelled) setLoading(false); }
    };

    setLoading(true);
    setSnap(null);
    histRef.current = [];
    setHistory([]);
    doLoad();
    const id = setInterval(doLoad, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((n) => <div key={n} className="flow-skeleton h-12 rounded-md" />)}
        </div>
        {[1, 2, 3].map((n) => <div key={n} className="flow-skeleton h-9 rounded-md" />)}
      </div>
    );
  }

  if (!snap) {
    return (
      <p className="font-mono text-[10px] text-zinc-700 text-center py-6">
        No dark pool data for {symbol}
      </p>
    );
  }

  const total    = snap.total_premium;
  const callPct  = total > 0 ? Math.round((snap.call_premium / total) * 100) : 0;
  const bias     = biasFromSnapshot(snap);
  const latestNet = history[history.length - 1]?.net ?? 0;
  const isBull    = latestNet >= 0;
  const sparkColor = isBull ? "#10b981" : "#f43f5e";

  return (
    <div className="space-y-3">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
          <p className="font-mono text-[8px] text-zinc-700 uppercase tracking-widest mb-1">Total</p>
          <p className="font-mono text-[12px] font-bold text-zinc-200 tabular-nums">{fmtPremium(total)}</p>
        </div>
        <div className="rounded-md border border-emerald-900/40 bg-emerald-950/10 px-2.5 py-2">
          <p className="font-mono text-[8px] text-emerald-800 uppercase tracking-widest mb-1">Calls</p>
          <p className="font-mono text-[12px] font-bold text-emerald-400 tabular-nums">{fmtPremium(snap.call_premium)}</p>
        </div>
        <div className="rounded-md border border-rose-900/40 bg-rose-950/10 px-2.5 py-2">
          <p className="font-mono text-[8px] text-rose-800 uppercase tracking-widest mb-1">Puts</p>
          <p className="font-mono text-[12px] font-bold text-rose-400 tabular-nums">{fmtPremium(snap.put_premium)}</p>
        </div>
      </div>

      {/* Call/Put bar + bias + PCR */}
      <div className="space-y-1.5">
        <div className="h-1.5 rounded-full overflow-hidden bg-zinc-900 flex">
          <motion.div
            className="h-full bg-gradient-to-r from-emerald-700 to-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${callPct}%` }}
            transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
          />
          <motion.div
            className="h-full bg-gradient-to-r from-rose-700 to-rose-500 flex-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className={clsx("font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded", bias.bg, bias.color)}>
            {bias.label}
          </span>
          <div className="flex items-center gap-3">
            {snap.pcr != null && (
              <span className="font-mono text-[9px] text-zinc-600">PCR {snap.pcr.toFixed(2)}</span>
            )}
            <span className="font-mono text-[9px] text-zinc-700">{callPct}% calls</span>
          </div>
        </div>
      </div>

      {/* Net history sparkline */}
      {history.length >= 3 && (
        <div className="h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`dpTickerGrad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={sparkColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <ReferenceLine y={0} stroke="#3f3f46" strokeWidth={1} />
              <Area type="monotone" dataKey="net" stroke={sparkColor} strokeWidth={1.5}
                fill={`url(#dpTickerGrad-${symbol})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Strike-level prints */}
      {snap.prints.length > 0 && (
        <div className="flow-scroll overflow-y-auto" style={{ maxHeight: 180 }}>
          <p className="font-mono text-[8px] tracking-[0.25em] uppercase text-zinc-700 mb-1.5">
            Prints · {snap.prints.length}
          </p>
          <div className="space-y-1">
            {snap.prints.map((p, i) => {
              const isBuy  = p.side === "buy";
              const isSell = p.side === "sell";
              return (
                <motion.div
                  key={`${p.strike}-${p.executed_at}-${i}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.18 }}
                  className={clsx(
                    "flex items-center gap-2 rounded-md border px-2.5 py-1.5",
                    isBuy  ? "border-emerald-900/30 bg-emerald-950/10" :
                    isSell ? "border-rose-900/30 bg-rose-950/10" :
                             "border-zinc-800/40 bg-zinc-900/20"
                  )}
                >
                  <span className={clsx(
                    "font-mono text-[9px] font-bold w-4",
                    isBuy ? "text-emerald-400" : isSell ? "text-rose-400" : "text-zinc-600"
                  )}>
                    {isBuy ? "↑" : isSell ? "↓" : "—"}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400 font-medium">
                    ${p.strike > 0 ? p.strike : "—"}
                  </span>
                  <span className={clsx(
                    "font-mono text-[11px] font-bold tabular-nums ml-auto",
                    isBuy ? "text-emerald-400" : isSell ? "text-rose-400" : "text-zinc-300"
                  )}>
                    {fmtPremium(p.premium)}
                  </span>
                  <span className="font-mono text-[9px] text-zinc-700 w-5 text-right flex-shrink-0">
                    {timeAgo(p.executed_at)}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

export function DarkPoolPanel() {
  const [activeTab, setActiveTab]     = useState<Tab>("MARKET");
  const [minPremium, setMinPremium]   = useState(0);

  return (
    <div className="flow-panel">
      {/* Header */}
      <div className="flow-panel-header flex-wrap gap-y-2">
        {/* Tab switcher */}
        <div className="flow-seg-group">
          {TICKER_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={clsx("flow-seg-btn", activeTab === t && "flow-seg-btn-active-all")}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Min-size filter — only on MARKET tab */}
        <AnimatePresence>
          {activeTab === "MARKET" && (
            <motion.div
              key="min-filter"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              className="flex gap-0.5 overflow-hidden"
            >
              {MIN_FILTERS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMinPremium(v)}
                  className={clsx(
                    "font-mono text-[9px] px-1.5 py-0.5 rounded transition-colors whitespace-nowrap",
                    minPremium === v
                      ? "text-zinc-200 bg-zinc-700"
                      : "text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800"
                  )}
                >
                  {v === 0 ? "ALL" : v >= 1_000_000 ? "$1M" : `$${v / 1000}K`}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Body */}
      <div className="flow-panel-body">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {activeTab === "MARKET" ? (
              <MarketTab minPremium={minPremium} />
            ) : (
              <TickerTab symbol={activeTab} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
