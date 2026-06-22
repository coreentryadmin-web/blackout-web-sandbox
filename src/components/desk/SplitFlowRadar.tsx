"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { fmtPremium } from "@/lib/api";

export type SplitFlowEntry = {
  ticker: string;
  callPremium: number;
  putPremium: number;
  callPct: number;
  total: number;
  direction: "bullish" | "bearish" | "mixed";
};

export function SplitFlowRadar({
  entries,
  onTickerClick,
}: {
  entries: SplitFlowEntry[];
  onTickerClick?: (ticker: string) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="flow-panel">
      {/* Header */}
      <div className="flow-panel-header">
        <div className="flex items-center gap-2">
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="font-mono text-[10px] text-amber-400"
          >
            ◈
          </motion.span>
          <span className="flow-panel-title">Split Flow Radar</span>
        </div>
        <span className="font-mono text-[9px] text-amber-600/60 tabular-nums">
          {entries.length} ticker{entries.length !== 1 ? "s" : ""} · 30min
        </span>
      </div>

      {/* Body */}
      <div className="flow-panel-body space-y-2">
        <AnimatePresence initial={false}>
          {entries.map((e, i) => {
            const isBull = e.direction === "bullish";
            const isBear = e.direction === "bearish";
            return (
              <motion.div
                key={e.ticker}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ delay: i * 0.04, type: "spring", damping: 22, stiffness: 300 }}
                onClick={() => onTickerClick?.(e.ticker)}
                className={clsx(
                  "rounded-xl border px-3 py-2.5 transition-colors",
                  onTickerClick && "cursor-pointer hover:border-amber-800/50",
                  "border-amber-900/25 bg-gradient-to-br from-amber-950/10 to-zinc-950/40"
                )}
                style={{ boxShadow: "inset 0 0 20px rgba(245,158,11,0.04)" }}
              >
                {/* Row 1: ticker + direction badge */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border"
                      style={{
                        color: "#f59e0b",
                        borderColor: "rgba(245,158,11,0.35)",
                        background: "rgba(245,158,11,0.08)",
                        letterSpacing: "0.08em",
                      }}
                    >
                      SPLIT
                    </span>
                    <span className="font-mono text-[15px] font-extrabold text-yellow-300 tracking-wider">
                      {e.ticker}
                    </span>
                  </div>
                  <span
                    className={clsx(
                      "font-mono text-[9px] font-bold px-2 py-0.5 rounded-full border",
                      isBull
                        ? "text-emerald-400 border-emerald-800/50 bg-emerald-950/40"
                        : isBear
                          ? "text-rose-400 border-rose-800/50 bg-rose-950/40"
                          : "text-sky-300 border-zinc-700 bg-zinc-900"
                    )}
                  >
                    {isBull ? "▲ CALL BIAS" : isBear ? "▼ PUT BIAS" : "⇋ NEUTRAL"}
                  </span>
                </div>

                {/* Row 2: call/put bar */}
                <div className="relative h-2 rounded-full overflow-hidden bg-zinc-900 flex mb-2">
                  <motion.div
                    className="h-full rounded-l-full"
                    style={{
                      background: "linear-gradient(90deg, #065f46, #10b981)",
                      width: `${e.callPct}%`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${e.callPct}%` }}
                    transition={{ duration: 0.9, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                  <motion.div
                    className="h-full rounded-r-full flex-1"
                    style={{
                      background: "linear-gradient(90deg, #9f1239, #f43f5e)",
                      width: `${100 - e.callPct}%`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${100 - e.callPct}%` }}
                    transition={{ duration: 0.9, ease: [0.34, 1.56, 0.64, 1], delay: 0.05 }}
                  />
                  {/* Center marker */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-zinc-600/60"
                    style={{ left: "50%" }}
                  />
                </div>

                {/* Row 3: premium breakdown */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[9px] text-emerald-500">
                      ▲ {fmtPremium(e.callPremium)} · {e.callPct}%
                    </span>
                    <span className="font-mono text-[9px] text-rose-500">
                      ▼ {fmtPremium(e.putPremium)} · {100 - e.callPct}%
                    </span>
                  </div>
                  <span className="font-mono text-[9px] text-cyan-400 tabular-nums">
                    {fmtPremium(e.total)}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Legend */}
        <p className="font-mono text-[8px] text-sky-500 text-center pt-1">
          Both call &amp; put ≥ $500K within 30 min window
        </p>
      </div>
    </div>
  );
}
