"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { computeFlowStrikeStacks, fmtFlowPremShort } from "@/lib/largo/flow-strike-stacks";
import { Panel, Badge } from "@/components/ui";

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
    <Panel
      accent="sky"
      title="Strike Stacks"
      strip={false}
      className="helix-pro-rail-panel"
      bodyClassName="!px-3 !py-2.5"
      actions={
        stacks.length > 0 ? (
          <Badge tone="neutral" size="sm">{stacks.length} active</Badge>
        ) : undefined
      }
    >
      <div className="flow-panel-body">
        <AnimatePresence mode="sync">
          {stacks.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-4 text-center"
            >
              <p className="font-mono text-[10px] text-cyan-400">Tracking strike accumulation…</p>
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
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
                    transition={{ delay: i * 0.05, type: "spring", damping: 22, stiffness: 300 }}
                    type="button"
                    onClick={() => onSelectTicker?.(stack.ticker)}
                    className={clsx(
                      "w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-200",
                      "hover:scale-[1.01] active:scale-[0.99] motion-reduce:hover:scale-100 motion-reduce:active:scale-100",
                      isCall
                        ? "border-bull/40 bg-bull/[0.08] hover:bg-bull/[0.14] hover:border-bull/60"
                        : "border-bear/40 bg-bear/[0.08] hover:bg-bear/[0.14] hover:border-bear/60"
                    )}
                    style={{ boxShadow: `inset 0 0 ${20 * intensity}px ${isCall ? "rgba(0,230,118,0.07)" : "rgba(255,45,85,0.06)"}` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Hit count */}
                        <span className={clsx(
                          "font-mono text-[11px] font-bold tabular-nums w-5 text-center rounded",
                          isCall ? "text-bull" : "text-bear"
                        )}>
                          ×{stack.alert_count}
                        </span>
                        <span className="font-anton text-[24px] text-gold leading-none">{stack.ticker}</span>
                        <span className={clsx("flow-badge", isCall ? "flow-badge-call" : "flow-badge-put")}>
                          {stack.option_type}
                        </span>
                        <span className={meta.cls}>{meta.label}</span>
                      </div>
                      <span className={clsx(
                        "font-mono text-[12px] font-bold tabular-nums flex-shrink-0",
                        isCall ? "text-bull" : "text-bear"
                      )}>
                        {fmtFlowPremShort(stack.total_premium)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-1.5 gap-2">
                      <p className="font-mono flex items-center gap-1.5">
                    <span className="font-bold tabular-nums text-[13px] text-gold">
                          {stack.strike}{isCall ? "C" : "P"}
                        </span>
                        <span className="text-cyan-400 text-[10px]">·</span>
                        <span
                          className={clsx(
                            "font-semibold text-[12px]",
                            isCall ? "text-bull" : "text-bear-text"
                          )}
                        >
                          {fmtExpiry(stack.expiry)}
                        </span>
                      </p>
                      <p className="font-mono text-[10px] text-cyan-400">
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
    </Panel>
  );
}
