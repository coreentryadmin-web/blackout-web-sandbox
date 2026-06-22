"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { fmtPremium } from "@/lib/api";
import type { PlaybookPlay } from "@/lib/nighthawk/types";

export type FlowConviction = "strong" | "moderate" | "weak" | "none";

export type NightHawkPlayWithFlow = PlaybookPlay & {
  flowData: {
    callPremium: number;
    putPremium: number;
    totalPremium: number;
    topPrint: number;
    printCount: number;
    flowAgreement: boolean; // flow direction agrees with play direction
    conviction: FlowConviction;
  };
};

const CONVICTION_STYLE: Record<FlowConviction, { label: string; cls: string }> = {
  strong:   { label: "STRONG",   cls: "text-emerald-400 border-emerald-700/50 bg-emerald-950/30" },
  moderate: { label: "MODERATE", cls: "text-amber-400   border-amber-700/50   bg-amber-950/25" },
  weak:     { label: "WEAK",     cls: "text-sky-300    border-zinc-700/50     bg-zinc-900/40" },
  none:     { label: "NO DATA",  cls: "text-cyan-400    border-zinc-800/50     bg-zinc-950/40" },
};

export function NightHawkFlowPanel({
  plays,
  editionFor,
  onTickerClick,
}: {
  plays: NightHawkPlayWithFlow[];
  editionFor?: string | null;
  onTickerClick?: (ticker: string) => void;
}) {
  if (plays.length === 0) return null;

  return (
    <div className="flow-panel">
      <div className="flow-panel-header">
        <div className="flex items-center gap-2">
          <motion.span
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
            className="font-mono text-[10px] text-indigo-400"
          >
            ◈
          </motion.span>
          <span className="flow-panel-title">Hawk Conviction</span>
        </div>
        {editionFor && (
          <span className="font-mono text-[9px] text-indigo-600/60">
            {editionFor}
          </span>
        )}
      </div>

      <div className="flow-panel-body space-y-2">
        <AnimatePresence initial={false}>
          {plays.map((play, i) => {
            const { flowData } = play;
            const { label: cvLabel, cls: cvCls } = CONVICTION_STYLE[flowData.conviction];
            const isLong = play.direction?.toLowerCase().includes("long") ||
                           play.direction?.toLowerCase().includes("bull");
            const callPct = flowData.totalPremium > 0
              ? Math.round((flowData.callPremium / flowData.totalPremium) * 100)
              : 0;

            return (
              <motion.div
                key={play.ticker}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ delay: i * 0.05, type: "spring", damping: 22, stiffness: 300 }}
                onClick={() => onTickerClick?.(play.ticker)}
                className="rounded-xl border border-indigo-900/25 bg-gradient-to-br from-indigo-950/10 to-zinc-950/40 px-3 py-2.5 cursor-pointer hover:border-indigo-700/35 transition-colors"
                style={{ boxShadow: "inset 0 0 16px rgba(99,102,241,0.04)" }}
              >
                {/* Row 1 */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border text-indigo-400 border-indigo-700/40 bg-indigo-950/30"
                      style={{ letterSpacing: "0.06em" }}>
                      #{play.rank} HAWK
                    </span>
                    <span className="font-mono text-[15px] font-extrabold text-indigo-200 tracking-wider">
                      {play.ticker}
                    </span>
                    <span className={clsx(
                      "font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full border",
                      isLong ? "text-emerald-400 border-emerald-800/50 bg-emerald-950/30"
                             : "text-rose-400 border-rose-800/50 bg-rose-950/30"
                    )}>
                      {isLong ? "▲ LONG" : "▼ SHORT"}
                    </span>
                  </div>
                  <span className={clsx(
                    "font-mono text-[9px] font-bold px-2 py-0.5 rounded-full border",
                    cvCls
                  )}>
                    {cvLabel}
                  </span>
                </div>

                {/* Row 2: flow stats */}
                {flowData.totalPremium > 0 ? (
                  <>
                    {/* Call/put bar */}
                    <div className="relative h-1.5 rounded-full overflow-hidden bg-zinc-900 mb-1.5">
                      <motion.div
                        className="h-full rounded-l-full"
                        style={{ background: "linear-gradient(90deg, #065f46, #10b981)", width: `${callPct}%` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${callPct}%` }}
                        transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
                      />
                      <div className="absolute inset-y-0 right-0 rounded-r-full"
                        style={{ background: "linear-gradient(90deg, #9f1239, #f43f5e)", width: `${100 - callPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-sky-300">
                        {flowData.printCount} prints · top {fmtPremium(flowData.topPrint)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className="font-mono text-[12px] font-bold"
                          style={{ color: "#34d399", textShadow: "0 0 6px rgba(52,211,153,0.5)" }}
                        >
                          {callPct}% C
                        </span>
                        <span
                          className="font-mono text-[12px] font-bold"
                          style={{ color: "#fb7185", textShadow: "0 0 6px rgba(251,113,133,0.5)" }}
                        >
                          {100 - callPct}% P
                        </span>
                        <span
                          className="font-mono font-bold tabular-nums"
                          style={{
                            fontSize: "13px",
                            color: "#a5b4fc",
                            textShadow: "0 0 8px rgba(165,180,252,0.5)",
                          }}
                        >
                          {fmtPremium(flowData.totalPremium)}
                        </span>
                      </div>
                    </div>
                    {flowData.flowAgreement && (
                      <p className="font-mono text-[10px] text-emerald-500 mt-1">
                        ✓ tape agrees with {isLong ? "long" : "short"} thesis
                      </p>
                    )}
                    {!flowData.flowAgreement && flowData.conviction !== "none" && (
                      <p className="font-mono text-[10px] text-amber-600 mt-1">
                        ⚠ tape diverges from {isLong ? "long" : "short"} thesis
                      </p>
                    )}
                  </>
                ) : (
                  <p className="font-mono text-[11px] text-cyan-400 mt-1">
                    No flow prints found in 7d window
                  </p>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        <p className="font-mono text-[8px] text-sky-500 text-center pt-1">
          Flow conviction from 7d tape · strong = $2M+ aligned
        </p>
      </div>
    </div>
  );
}
