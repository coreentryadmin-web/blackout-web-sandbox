"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { computeFlowStrikeStacks, fmtFlowPremShort } from "@/lib/largo/flow-strike-stacks";

function fmtExpiry(expiry: string): string {
  if (!expiry) return "";
  const [y, m, d] = expiry.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

const KIND_META = {
  repeated_and_stacked: { label: "REPEAT + STACK", cls: "flow-badge flow-badge-stack" },
  repeated_hits:        { label: "REPEAT",          cls: "flow-badge flow-badge-repeat" },
  same_strike_stack:    { label: "STACKED",          cls: "flow-badge flow-badge-block" },
} as const;

export function StrikeStackDetector({
  alerts,
  onSelectTicker,
}: {
  alerts: FlowAlert[];
  onSelectTicker?: (ticker: string) => void;
}) {
  const stacks = useMemo(
    () => computeFlowStrikeStacks(alerts, { minAlerts: 2, limit: 5 }),
    [alerts]
  );

  return (
    <div className="flow-panel">
      <div className="flow-panel-header">
        <span className="flow-panel-title">Strike Stacks</span>
        {stacks.length > 0 && (
          <span className="font-mono text-[9px] text-amber-600">{stacks.length} active</span>
        )}
      </div>

      <div className="flow-panel-body">
        <AnimatePresence mode="popLayout">
          {stacks.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-4 text-center"
            >
              <p className="font-mono text-[10px] text-zinc-500">Watching for accumulation…</p>
            </motion.div>
          ) : (
            <div className="space-y-2">
              {stacks.map((stack, i) => {
                const isCall = stack.option_type === "CALL";
                const meta   = KIND_META[stack.kind];
                const intensity = Math.min(stack.alert_count / 5, 1);

                return (
                  <motion.button
                    key={`${stack.ticker}-${stack.strike}-${stack.option_type}-${stack.expiry}`}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
                    transition={{ delay: i * 0.05, type: "spring", damping: 22, stiffness: 300 }}
                    type="button"
                    onClick={() => onSelectTicker?.(stack.ticker)}
                    className={clsx(
                      "w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-200",
                      "hover:scale-[1.01] active:scale-[0.99]",
                      isCall
                        ? "border-fuchsia-900/50 bg-fuchsia-950/10 hover:bg-fuchsia-950/20 hover:border-fuchsia-800/50"
                        : "border-rose-900/50 bg-rose-950/15 hover:bg-rose-950/25 hover:border-rose-800/60"
                    )}
                    style={{ boxShadow: `inset 0 0 ${20 * intensity}px ${isCall ? "rgba(217,70,239,0.07)" : "rgba(244,63,94,0.06)"}` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Hit count */}
                        <span className={clsx(
                          "font-mono text-[11px] font-bold tabular-nums w-5 text-center rounded",
                          isCall ? "text-fuchsia-300" : "text-rose-300"
                        )}>
                          ×{stack.alert_count}
                        </span>
                        <span className="font-anton text-[14px] text-yellow-300 leading-none">{stack.ticker}</span>
                        <span className={clsx("flow-badge", isCall ? "flow-badge-call" : "flow-badge-put")}>
                          {stack.option_type}
                        </span>
                        <span className={meta.cls}>{meta.label}</span>
                      </div>
                      <span className={clsx(
                        "font-mono text-[12px] font-bold tabular-nums flex-shrink-0",
                        isCall ? "text-fuchsia-400" : "text-rose-400"
                      )}>
                        {fmtFlowPremShort(stack.total_premium)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-1.5 gap-2">
                      <p className="font-mono flex items-center gap-1.5">
                        <span
                          className="font-bold tabular-nums"
                          style={{
                            fontSize: "13px",
                            color: "#fde047",
                            textShadow: "0 0 10px rgba(253,224,71,0.6)",
                          }}
                        >
                          {stack.strike}{isCall ? "C" : "P"}
                        </span>
                        <span className="text-zinc-600 text-[10px]">·</span>
                        <span
                          className="font-semibold"
                          style={{
                            fontSize: "12px",
                            color: isCall ? "#f0abfc" : "#fda4af",
                            textShadow: isCall ? "0 0 8px rgba(240,171,252,0.5)" : "0 0 8px rgba(253,164,175,0.5)",
                          }}
                        >
                          {fmtExpiry(stack.expiry)}
                        </span>
                      </p>
                      <p className="font-mono text-[10px] text-zinc-500">
                        {stack.premiums.map(fmtFlowPremShort).join(" + ")}
                      </p>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
