"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";

type Row = { ticker: string; calls: number; puts: number; net: number; total: number; callPct: number };

export function NetPremiumLeaderboard({ alerts }: { alerts: FlowAlert[] }) {
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, { calls: number; puts: number }>();
    for (const a of alerts) {
      const cur = map.get(a.ticker) ?? { calls: 0, puts: 0 };
      if (a.option_type === "CALL") cur.calls += a.premium;
      else cur.puts += a.premium;
      map.set(a.ticker, cur);
    }
    return Array.from(map.entries())
      .map(([ticker, { calls, puts }]) => ({
        ticker,
        calls,
        puts,
        net: calls - puts,
        total: calls + puts,
        callPct: calls + puts > 0 ? Math.round((calls / (calls + puts)) * 100) : 50,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [alerts]);

  const maxTotal = rows[0]?.total ?? 1;

  return (
    <div className="flow-panel">
      <div className="flow-panel-header">
        <span className="flow-panel-title">Net Premium</span>
        {rows.length > 0 && (
          <span className="font-mono text-[9px] text-zinc-400 font-semibold">
            {fmtPremium(rows.reduce((s, r) => s + r.total, 0))} total
          </span>
        )}
      </div>

      <div className="flow-panel-body space-y-3">
        {rows.length === 0 ? (
          <div className="space-y-2 py-1">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flow-skeleton h-8 rounded-md" />
            ))}
          </div>
        ) : (
          rows.map((row, i) => {
            const isBull = row.net >= 0;
            const barW = Math.round((row.total / maxTotal) * 100);
            const callBarW = Math.round((row.calls / row.total) * barW);
            const putBarW  = barW - callBarW;

            return (
              <motion.div
                key={row.ticker}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, type: "spring", damping: 24, stiffness: 300 }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-anton text-[13px] text-yellow-300 leading-none tracking-wide">{row.ticker}</span>
                    <span className={clsx(
                      "font-mono text-[9px] tracking-wider uppercase",
                      isBull ? "text-fuchsia-400" : "text-rose-500"
                    )}>
                      {isBull ? "↑" : "↓"} {row.callPct}%
                    </span>
                  </div>
                  <span className={clsx(
                    "font-mono text-[11px] font-semibold tabular-nums",
                    isBull ? "text-fuchsia-400" : "text-rose-400"
                  )}>
                    {isBull ? "+" : ""}{fmtPremium(row.net)}
                  </span>
                </div>

                {/* Dual bar */}
                <div className="flow-leader-bar-track">
                  <div className="flex h-full">
                    {callBarW > 0 && (
                      <motion.div
                        className="flow-leader-bar-fill"
                        style={{ background: "linear-gradient(90deg, #a21caf, #e879f9)", width: `${callBarW}%` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${callBarW}%` }}
                        transition={{ duration: 0.6, delay: i * 0.06, ease: [0.34, 1.56, 0.64, 1] }}
                      />
                    )}
                    {putBarW > 0 && (
                      <motion.div
                        className="flow-leader-bar-fill"
                        style={{ background: "linear-gradient(90deg, #e11d48, #f43f5e)", width: `${putBarW}%` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${putBarW}%` }}
                        transition={{ duration: 0.6, delay: i * 0.06 + 0.05, ease: [0.34, 1.56, 0.64, 1] }}
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
