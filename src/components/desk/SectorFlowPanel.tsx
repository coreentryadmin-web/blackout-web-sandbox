"use client";

import { motion, AnimatePresence } from "framer-motion";
import { fmtPremium } from "@/lib/api";
import { SECTOR_ORDER } from "@/lib/sector-map";

export type SectorFlowEntry = {
  sector: string;
  callPremium: number;
  putPremium: number;
  total: number;
  callPct: number;
};

export function SectorFlowPanel({
  entries,
}: {
  entries: SectorFlowEntry[];
}) {
  if (entries.length === 0) return null;

  // Sort by SECTOR_ORDER then by total premium for unlisted sectors
  const sorted = [...entries].sort((a, b) => {
    const ai = SECTOR_ORDER.indexOf(a.sector);
    const bi = SECTOR_ORDER.indexOf(b.sector);
    if (ai !== -1 && bi !== -1) return b.total - a.total;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return b.total - a.total;
  }).sort((a, b) => b.total - a.total);

  const maxTotal = sorted[0]?.total ?? 1;

  return (
    <div className="flow-panel">
      <div className="flow-panel-header">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-sky-400">▦</span>
          <span className="flow-panel-title">Sector Flow</span>
        </div>
        <span className="font-mono text-[9px] text-sky-600/60 tabular-nums">
          7d rotation
        </span>
      </div>

      <div className="flow-panel-body space-y-1.5">
        <AnimatePresence initial={false}>
          {sorted.map((e, i) => {
            const isBull = e.callPct >= 55;
            const isBear = e.callPct <= 45;
            const widthPct = Math.max(8, (e.total / maxTotal) * 100);

            return (
              <motion.div
                key={e.sector}
                layout="position"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.03, duration: 0.2 }}
                className="space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold text-zinc-300 w-24 truncate">
                    {e.sector}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[9px] font-bold ${
                      isBull ? "text-emerald-400" : isBear ? "text-rose-400" : "text-zinc-400"
                    }`}>
                      {e.callPct}% C
                    </span>
                    <span className="font-mono text-[9px] text-zinc-600 tabular-nums">
                      {fmtPremium(e.total)}
                    </span>
                  </div>
                </div>

                {/* Call / put bar */}
                <div className="relative h-1.5 rounded-full overflow-hidden bg-zinc-900">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      background: isBull
                        ? "linear-gradient(90deg, #065f46, #10b981)"
                        : isBear
                          ? "linear-gradient(90deg, #9f1239, #f43f5e)"
                          : "linear-gradient(90deg, #3f3f46, #71717a)",
                      width: `${widthPct}%`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${widthPct}%` }}
                    transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1], delay: i * 0.04 }}
                  />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        <p className="font-mono text-[8px] text-zinc-800 text-center pt-1">
          Premium weighted · bar = relative size vs top sector
        </p>
      </div>
    </div>
  );
}
