"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePulse } from "@/lib/usePulse";
import { AreaChart, Area, ResponsiveContainer, ReferenceLine } from "recharts";
import { clsx } from "clsx";
import {
  fmtPremium,
  fetchDarkPoolPrints,
  type DarkPoolRow,
} from "@/lib/api";

const POLL_MS     = 30_000;
const MAX_HISTORY = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    const hr = String(d.getHours()).padStart(2, "0");
    const mn = String(d.getMinutes()).padStart(2, "0");
    return `${mo}/${dy} ${hr}:${mn}`;
  } catch {
    return timeAgo(iso);
  }
}

function fmtShares(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1000)}K`;
  return String(n);
}

function biasFromSide(prints: DarkPoolRow[]) {
  const buy   = prints.filter((p) => p.side === "buy").reduce((s, p) => s + p.premium, 0);
  const sell  = prints.filter((p) => p.side === "sell").reduce((s, p) => s + p.premium, 0);
  const total = buy + sell;
  if (total <= 0) return { label: "MIXED",   color: "#71717a", glow: "rgba(113,113,122,0.3)" };
  const r = buy / total;
  if (r >= 0.65) return { label: "BULLISH",  color: "#34d399", glow: "rgba(52,211,153,0.35)" };
  if (r <= 0.35) return { label: "BEARISH",  color: "#fb7185", glow: "rgba(251,113,133,0.35)" };
  return         { label: "MIXED",   color: "#94a3b8", glow: "rgba(148,163,184,0.2)" };
}

// ─── Shared print row ─────────────────────────────────────────────────────────

function PrintRow({ p, showDate = false }: { p: DarkPoolRow; showDate?: boolean }) {
  const isBuy  = p.side === "buy";
  const isSell = p.side === "sell";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className={clsx(
        "flex items-center gap-2 rounded-lg px-3 py-2.5 border transition-colors cursor-default",
        isBuy  ? "border-emerald-600/40 bg-emerald-950/25 hover:bg-emerald-950/40 hover:border-emerald-500/60" :
        isSell ? "border-rose-600/40    bg-rose-950/25    hover:bg-rose-950/40    hover:border-rose-500/60" :
                 "border-zinc-700/30    bg-zinc-900/20    hover:bg-zinc-900/40"
      )}
      style={{
        boxShadow: isBuy  ? "inset 0 0 12px rgba(52,211,153,0.05)"
                  : isSell ? "inset 0 0 12px rgba(251,113,133,0.05)"
                  : "none",
      }}
    >
      {/* Side arrow */}
      <span
        className="font-mono text-[14px] font-black w-4 flex-shrink-0"
        style={{
          color: isBuy ? "#34d399" : isSell ? "#fb7185" : "#52525b",
          textShadow: isBuy  ? "0 0 6px rgba(52,211,153,0.7)"
                    : isSell ? "0 0 6px rgba(251,113,133,0.7)"
                    : "none",
        }}
      >
        {isBuy ? "↑" : isSell ? "↓" : "—"}
      </span>

      {/* Ticker */}
      <span
        className="font-anton text-[14px] leading-none flex-shrink-0"
        style={{ color: isBuy ? "#6ee7b7" : isSell ? "#fda4af" : "#d4d4d8" }}
      >
        {p.ticker}
      </span>

      {/* Share size — the key "institutional block" metric */}
      {p.share_size != null && p.share_size > 0 && (
        <span
          className="font-mono text-[12px] font-semibold flex-shrink-0"
          style={{ color: isBuy ? "#6ee7b7" : isSell ? "#fda4af" : "#a1a1aa" }}
        >
          {fmtShares(p.share_size)} shares
        </span>
      )}

      {/* Block value */}
      <span
        className="font-mono font-bold tabular-nums ml-auto flex-shrink-0"
        style={{
          fontSize: "15px",
          color: isBuy ? "#34d399" : isSell ? "#fb7185" : "#e4e4e7",
          textShadow: isBuy  ? "0 0 10px rgba(52,211,153,0.55)"
                    : isSell ? "0 0 10px rgba(251,113,133,0.55)"
                    : "none",
        }}
      >
        {fmtPremium(p.premium)}
      </span>

      {/* Date or timeago */}
      <span className="font-mono text-[10px] text-cyan-400 flex-shrink-0 text-right"
        style={{ minWidth: showDate ? "72px" : "20px" }}>
        {showDate ? fmtDate(p.executed_at) : timeAgo(p.executed_at)}
      </span>
    </motion.div>
  );
}

// ─── Root component — all data fetched here, filtered client-side ─────────────

export function DarkPoolPanel() {
  const [allPrints, setAllPrints]   = useState<DarkPoolRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [history, setHistory]       = useState<{ t: number; net: number }[]>([]);
  const [search, setSearch]         = useState("");
  const [activeTicker, setActiveTicker] = useState("");

  // Fetch a larger pool so client-side ticker filtering actually finds prints
  const load = useCallback(async () => {
    try {
      const res  = await fetchDarkPoolPrints({ limit: 200 });
      const rows = res.prints ?? [];
      setAllPrints(rows);
      const buy  = rows.filter((p) => p.side === "buy").reduce((s, p) => s + p.premium, 0);
      const sell = rows.filter((p) => p.side === "sell").reduce((s, p) => s + p.premium, 0);
      setHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), { t: Date.now(), net: buy - sell }]);
    } catch (e) { console.warn("[DarkPoolPanel] fetch error:", e); }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Debounce ticker switch 400ms after user stops typing
  useEffect(() => {
    const val = search.trim().toUpperCase();
    const id  = setTimeout(() => setActiveTicker(val), 400);
    return () => clearTimeout(id);
  }, [search]);

  // Filtered view
  const visible = activeTicker
    ? allPrints.filter((p) => p.ticker === activeTicker)
    : allPrints.slice(0, 60);

  const bias       = biasFromSide(visible);
  const latestNet  = history[history.length - 1]?.net ?? 0;
  const isBull     = latestNet >= 0;
  const sparkColor = isBull ? "#34d399" : "#fb7185";

  // Ticker summary stats
  const tickerTotal = visible.reduce((s, p) => s + p.premium, 0);

  // Hoisted (no early return in this component, but kept top-level for Rules of Hooks).
  const pulse = usePulse({ opacity: [1, 0.3, 1] }, { repeat: Infinity, duration: 2.5, ease: "easeInOut" });

  return (
    <div className="flow-panel">
      {/* ── Header ── */}
      <div className="flow-panel-header flex-wrap gap-y-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <motion.span
            {...pulse}
            className="text-[11px]"
            style={{ color: "#a78bfa", textShadow: "0 0 8px rgba(167,139,250,0.6)" }}
          >
            ⬡
          </motion.span>
          <span className="flow-panel-title">Dark Pool</span>
        </div>

        {/* Ticker search */}
        <div className="relative ml-auto">
          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))
            }
            placeholder="NVDA, TSLA…"
            maxLength={6}
            className="font-mono text-[11px] font-bold uppercase px-3 py-1 rounded-lg border bg-zinc-950 outline-none w-28 tracking-widest transition-all"
            style={{
              borderColor: search ? "rgba(167,139,250,0.65)" : "rgba(167,139,250,0.22)",
              color:       search ? "#c4b5fd" : "#52525b",
              boxShadow:   search ? "0 0 0 2px rgba(167,139,250,0.12)" : "none",
            }}
          />
          <AnimatePresence>
            {search && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-cyan-400 hover:text-sky-200 font-mono text-sm font-bold"
              >
                ×
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flow-panel-body">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTicker || "__market__"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {/* ── Ticker header (when filtering) ── */}
            {activeTicker && (
              <div className="mb-3 rounded-xl border border-violet-700/30 bg-violet-950/15 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-anton text-[18px] text-violet-200 leading-none">
                      {activeTicker}
                    </span>
                    {visible.length > 0 && (
                      <span className="font-mono text-[11px] text-cyan-400">
                        {visible.length} block{visible.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {visible.length > 0 && (
                    <div className="flex items-center gap-3">
                      <span
                        className="font-mono font-bold tabular-nums"
                        style={{
                          fontSize: "15px",
                          color: "#c4b5fd",
                          textShadow: "0 0 10px rgba(196,181,253,0.5)",
                        }}
                      >
                        {fmtPremium(tickerTotal)}
                      </span>
                      <span
                        className="font-mono text-[11px] font-bold px-2 py-0.5 rounded"
                        style={{
                          color: bias.color,
                          background: "rgba(0,0,0,0.5)",
                          border: `1px solid ${bias.color}44`,
                          boxShadow: `0 0 8px ${bias.glow}`,
                        }}
                      >
                        {bias.label}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Market bias + sparkline (market view only) ── */}
            {!activeTicker && !loading && allPrints.length > 0 && (
              <div className="flex items-center gap-3 px-1 mb-2">
                <span
                  className="font-mono text-[11px] font-bold px-2 py-0.5 rounded"
                  style={{
                    color: bias.color,
                    background: "rgba(0,0,0,0.5)",
                    border: `1px solid ${bias.color}44`,
                    boxShadow: `0 0 8px ${bias.glow}`,
                  }}
                >
                  {bias.label}
                </span>
                {history.length >= 3 && (
                  <div className="flex-1 h-6">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="dpSparkGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"   stopColor={sparkColor} stopOpacity={0.45} />
                            <stop offset="100%" stopColor={sparkColor} stopOpacity={0}    />
                          </linearGradient>
                        </defs>
                        <ReferenceLine y={0} stroke="#3f3f46" strokeWidth={1} />
                        <Area type="monotone" dataKey="net" stroke={sparkColor} strokeWidth={2}
                          fill="url(#dpSparkGrad)" dot={false} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <span
                  className="font-mono text-[12px] font-bold tabular-nums"
                  style={{ color: sparkColor, textShadow: `0 0 8px ${sparkColor}66` }}
                >
                  {isBull ? "+" : ""}{fmtPremium(latestNet)}
                </span>
              </div>
            )}

            {/* ── Prints list ── */}
            <div className="flow-scroll overflow-y-auto" style={{ maxHeight: 300 }}>
              {loading ? (
                <div className="space-y-1.5">
                  {[1, 2, 3, 4].map((n) => <div key={n} className="flow-skeleton h-11 rounded-md" />)}
                </div>
              ) : visible.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="font-mono text-[12px] text-cyan-400">
                    {activeTicker
                      ? `No block trades found for ${activeTicker} in current tape`
                      : "No prints available"}
                  </p>
                  {activeTicker && (
                    <p className="font-mono text-[10px] text-cyan-500 mt-1">
                      Try a high-volume ticker like NVDA, TSLA, SPY
                    </p>
                  )}
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  <div className="space-y-1">
                    {visible.map((p, i) => (
                      <PrintRow
                        key={`${p.ticker}-${p.executed_at}-${i}`}
                        p={p}
                        showDate={!!activeTicker}
                      />
                    ))}
                  </div>
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
