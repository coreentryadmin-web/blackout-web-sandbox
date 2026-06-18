"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { DeskPanel } from "./DeskPanel";

const WHALE_PREMIUM = 1_000_000;

export function FlowAlertStream({
  flows,
  live,
  loading,
}: {
  flows: FlowAlert[];
  live?: boolean;
  loading?: boolean;
}) {
  const feedStatus = loading ? undefined : live ? "live" : "reconnecting";
  const connected = live ?? false;

  return (
    <DeskPanel
      title="Flow Tape"
      subtitle="Unusual Whales · live sweep"
      variant="purple"
      feedStatus={feedStatus}
      glow
    >
      <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {flows.length === 0 ? (
            <p className="text-grey-500 text-sm font-mono py-8 text-center">
              {connected ? "Waiting for flow alerts…" : "Add UW_API_KEY on Railway for live flow tape"}
            </p>
          ) : (
            flows.map((flow, i) => {
              const isCall = flow.option_type?.toLowerCase() === "call";
              const isWhale = flow.premium >= WHALE_PREMIUM;

              return (
                <motion.div
                  key={`${flow.ticker}-${flow.alerted_at}-${i}`}
                  initial={{
                    opacity: 0,
                    x: -16,
                    backgroundColor: "rgba(0,230,118,0.12)",
                  }}
                  animate={{
                    opacity: 1,
                    x: 0,
                    backgroundColor: "rgba(0,230,118,0)",
                  }}
                  transition={{
                    opacity: { duration: 0.3 },
                    x: { duration: 0.3 },
                    backgroundColor: { duration: 1.8 },
                  }}
                  className={clsx(
                    "desk-flow-card",
                    isCall ? "desk-flow-row-call" : "desk-flow-row-put"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-anton text-xl text-white">{flow.ticker}</span>
                        <span
                          className={clsx(
                            "desk-flow-badge",
                            isCall ? "desk-flow-call" : "desk-flow-put",
                            isWhale && "badge-whale"
                          )}
                        >
                          {flow.option_type}
                        </span>
                        <span className="text-[10px] font-mono text-grey-500 uppercase">{flow.direction}</span>
                      </div>
                      <p className="font-mono text-xs text-grey-400 mt-1">
                        ${flow.strike} · {flow.expiry} · {flow.route}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-lg font-bold text-bull">{fmtPremium(flow.premium)}</p>
                      <p className="text-[10px] font-mono text-grey-500">score {flow.score}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </DeskPanel>
  );
}
