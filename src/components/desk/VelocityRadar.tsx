"use client";

import { motion, AnimatePresence } from "framer-motion";
import { fmtPremium } from "@/lib/api";

export type VelocityEntry = {
  ticker: string;
  recent: number;       // prints in last 15 min
  prior: number;        // prints in prior 15 min (15–30 min ago)
  ratio: number;        // acceleration multiplier
  recentPremium: number;
};

export function VelocityRadar({
  entries,
  onTickerClick,
}: {
  entries: VelocityEntry[];
  onTickerClick?: (ticker: string) => void;
}) {
  if (entries.length === 0) return null;

  const maxRatio = Math.max(...entries.map((e) => e.ratio), 1);

  return (
    <div className="flow-panel">
      <div className="flow-panel-header">
        <div className="flex items-center gap-2">
          <motion.span
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
            className="font-mono text-[10px] text-orange-400"
          >
            ◉
          </motion.span>
          <span className="flow-panel-title">Velocity Radar</span>
        </div>
        <span className="font-mono text-[9px] text-orange-600/60 tabular-nums">
          {entries.length} spike{entries.length !== 1 ? "s" : ""} · 15min
        </span>
      </div>

      <div className="flow-panel-body space-y-2">
        <AnimatePresence initial={false}>
          {entries.map((e, i) => {
            const barPct = Math.min(100, (e.ratio / maxRatio) * 100);
            return (
              <motion.div
                key={e.ticker}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ delay: i * 0.04, type: "spring", damping: 22, stiffness: 300 }}
                onClick={() => onTickerClick?.(e.ticker)}
                className="rounded-xl border border-orange-900/30 bg-gradient-to-br from-orange-950/15 to-zinc-950/50 px-3 py-2.5 cursor-pointer hover:border-orange-700/40 transition-colors"
                style={{ boxShadow: "inset 0 0 18px rgba(251,146,60,0.04)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border animate-pulse"
                      style={{
                        color: "#fb923c",
                        borderColor: "rgba(251,146,60,0.4)",
                        background: "rgba(251,146,60,0.1)",
                        letterSpacing: "0.06em",
                      }}
                    >
                      SPIKE
                    </span>
                    <span className="font-mono text-[15px] font-extrabold text-orange-300 tracking-wider">
                      {e.ticker}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-[13px] font-bold text-orange-400 tabular-nums">
                      {e.ratio.toFixed(1)}×
                    </span>
                  </div>
                </div>

                {/* Velocity bar */}
                <div className="relative h-1.5 rounded-full overflow-hidden bg-zinc-900 mb-2">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, #92400e, #fb923c)" }}
                    initial={{ width: 0 }}
                    animate={{ width: `${barPct}%` }}
                    transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] text-zinc-500">
                    {e.recent} prints last 15m · {e.prior} prior
                  </span>
                  <span className="font-mono text-[9px] text-orange-600 tabular-nums">
                    {fmtPremium(e.recentPremium)}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        <p className="font-mono text-[8px] text-zinc-800 text-center pt-1">
          ≥3× acceleration vs prior 15 min window · min 2 prints
        </p>
      </div>
    </div>
  );
}
