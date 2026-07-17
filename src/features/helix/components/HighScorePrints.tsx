"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { fmtPremium, type FlowAlert } from "@/lib/api";
import { Panel, Skeleton } from "@/components/ui";
import { selectTopPrints } from "@/features/helix/lib/helix-top-prints";

function scoreTone(score: number): { bg: string; border: string; text: string } {
  if (score >= 9) return { bg: "rgba(250,204,21,0.08)", border: "rgba(250,204,21,0.3)", text: "#facc15" };
  if (score >= 7) return { bg: "rgba(0,230,118,0.06)", border: "rgba(0,230,118,0.25)", text: "#00e676" };
  return { bg: "rgba(125,211,252,0.06)", border: "rgba(125,211,252,0.2)", text: "#7dd3fc" };
}

export function HighScorePrints({
  alerts,
  loading,
  onSelect,
}: {
  alerts: FlowAlert[];
  loading: boolean;
  onSelect?: (alert: FlowAlert) => void;
}) {
  const { rows: top, mode } = useMemo(() => selectTopPrints(alerts), [alerts]);

  return (
    <Panel
      accent="gold"
      kicker={mode === "score" ? "★ conviction" : "◆ size"}
      title="Top Prints"
      className="helix-pro-rail-panel"
      bodyClassName="space-y-1.5"
    >
      {loading && top.length === 0 ? (
        <div className="space-y-1.5 py-1">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} height={36} rounded="md" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <p className="font-mono text-[10px] text-cyan-400 text-center py-3">
          No prints on this filter yet — widen filters or wait for flow.
        </p>
      ) : (
        <AnimatePresence initial={false}>
          {top.map((a, i) => {
            const isCall = a.option_type?.toUpperCase() === "CALL";
            const tone = scoreTone(a.score);
            return (
              <motion.div
                key={a.alert_id ?? `${a.ticker}-${a.strike}-${a.expiry}-${i}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.03, duration: 0.2 }}
                onClick={() => onSelect?.(a)}
                role={onSelect ? "button" : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onKeyDown={
                  onSelect
                    ? (ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          onSelect(a);
                        }
                      }
                    : undefined
                }
                className="flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors hover:bg-white/[0.04]"
                style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="font-mono text-[13px] font-black tabular-nums w-8 text-center"
                    style={{ color: tone.text }}
                  >
                    {a.score > 0 ? a.score.toFixed(1) : "—"}
                  </span>
                  <span className="font-mono text-[12px] font-bold text-white tracking-wide">{a.ticker}</span>
                  <span
                    className={clsx(
                      "font-mono text-[11px] font-semibold",
                      isCall ? "text-bull" : "text-bear-text"
                    )}
                  >
                    {a.strike}
                    {isCall ? "C" : "P"}
                  </span>
                </div>
                <span
                  className={clsx(
                    "font-mono text-[12px] font-bold tabular-nums",
                    isCall ? "num-bull" : "num-bear"
                  )}
                >
                  {fmtPremium(a.premium)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
      <p className="font-mono text-[10px] text-sky-300/70 text-center pt-1">
        {mode === "score"
          ? "Highest-scored prints on the tape · click to drill down"
          : "Largest prints on this filter · click to drill down"}
      </p>
    </Panel>
  );
}
