"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { Panel, Skeleton } from "@/components/ui";

type Row = { ticker: string; calls: number; puts: number; net: number; total: number; callPct: number };

export function NetPremiumLeaderboard({ alerts }: { alerts: FlowAlert[] }) {
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, { calls: number; puts: number }>();
    for (const a of alerts) {
      const cur = map.get(a.ticker) ?? { calls: 0, puts: 0 };
      if (a.option_type === "CALL") cur.calls += a.premium;
      else if (a.option_type === "PUT") cur.puts += a.premium;
      // gap-#6: UNKNOWN/typeless prints count toward neither side
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
    <Panel
      accent="bull"
      title="Net Premium"
      bodyClassName="!px-4 !py-3.5"
      actions={
        rows.length > 0 ? (
          <span className="font-mono text-[10px] text-sky-300 font-semibold">
            {fmtPremium(rows.reduce((s, r) => s + r.total, 0))} total
          </span>
        ) : undefined
      }
    >
      <div className="flow-panel-body space-y-3">
        {rows.length === 0 ? (
          <div className="space-y-2 py-1">
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} height={32} rounded="md" />
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
                    <span className="font-anton text-[24px] text-gold leading-none tracking-wide">{row.ticker}</span>
                    <span className={clsx(
                      "font-mono text-[10px] font-bold tracking-wider",
                      isBull ? "text-bull" : "text-bear-text"
                    )}
                    style={isBull
                      ? { textShadow: "0 0 8px rgba(0,230,118,0.7)" }
                      : { textShadow: "0 0 8px rgba(255,45,85,0.7)" }
                    }>
                      {isBull ? "▲" : "▼"} {row.callPct}%
                    </span>
                  </div>
                  <span
                    className="font-mono font-bold tabular-nums"
                    style={{
                      fontSize: "13px",
                      color: isBull ? "#00e676" : "#ff2d55",
                      textShadow: isBull ? "0 0 10px rgba(0,230,118,0.6)" : "0 0 10px rgba(255,45,85,0.6)",
                    }}
                  >
                    {isBull ? "+" : ""}{fmtPremium(row.net)}
                  </span>
                </div>

                {/* Dual bar */}
                <div className="flow-leader-bar-track">
                  <div className="flex h-full">
                    {callBarW > 0 && (
                      <motion.div
                        className="flow-leader-bar-fill"
                        style={{ background: "linear-gradient(90deg, #0f9d58, #00e676)", width: `${callBarW}%` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${callBarW}%` }}
                        transition={{ duration: 0.6, delay: i * 0.06, ease: [0.34, 1.56, 0.64, 1] }}
                      />
                    )}
                    {putBarW > 0 && (
                      <motion.div
                        className="flow-leader-bar-fill"
                        style={{ background: "linear-gradient(90deg, #b3203f, #ff2d55)", width: `${putBarW}%` }}
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
    </Panel>
  );
}
