"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export const LARGO_THINKING_PHRASES = [
  "Pulling the live tape…",
  "Reading dealer gamma…",
  "Cross-referencing flow against GEX…",
  "Cortex is lining up the evidence…",
  "Talking to HELIX — largest prints this session…",
  "Syncing the SPX Slayer desk…",
  "Running confluence on your ask…",
  "Stress-testing your thesis…",
  "Mapping gamma walls in real time…",
  "Redis warm · RDS online · feeds live…",
  "Unusual Whales on speed-dial…",
  "Polygon chain geometry loading…",
  "Building the read — this one's worth the wait…",
] as const;

const PIPELINE_NODES = [
  { label: "TAPE", color: "cyan" },
  { label: "DESK", color: "green" },
  { label: "FLOW", color: "purple" },
  { label: "ENGINE", color: "magenta" },
] as const;

type LargoThinkingStateProps = {
  active?: boolean;
  /** Live tool-trace — friendly labels of the data sources Largo is pulling this turn. */
  tools?: string[];
  /** Server-pushed status (prefetch / enrich / Cortex copy) — takes headline priority. */
  statusMessage?: string | null;
};

export function LargoThinkingState({ active = true, tools = [], statusMessage = null }: LargoThinkingStateProps) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) {
      setPhraseIdx(0);
      setTick(0);
      return;
    }
    const phraseTimer = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % LARGO_THINKING_PHRASES.length);
    }, 2200);
    const tickTimer = setInterval(() => setTick((t) => t + 1), 600);
    return () => {
      clearInterval(phraseTimer);
      clearInterval(tickTimer);
    };
  }, [active]);

  // Dynamic status: once Largo starts pulling real data sources for THIS request, the
  // headline names what it's actually fetching ("Reading dark pool…", "Pulling options
  // flow…") instead of a generic rotation. Falls back to the rotation only in the brief
  // window before the first tool fires.
  const STATUS_VERBS = ["Reading", "Pulling", "Fetching", "Scanning", "Cross-referencing"] as const;
  const latestTool = tools.length > 0 ? tools[tools.length - 1] : null;
  const phrase = statusMessage?.trim()
    ? statusMessage.trim()
    : latestTool
      ? `${STATUS_VERBS[(tools.length - 1) % STATUS_VERBS.length]} ${latestTool}…`
      : LARGO_THINKING_PHRASES[phraseIdx];
  const activeNode = tick % PIPELINE_NODES.length;

  return (
    <motion.div
      className="largo-thinking-panel"
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      aria-live="polite"
      aria-busy="true"
    >
      <div className="largo-thinking-scan" aria-hidden />
      <div className="largo-neural-core-wrap" aria-hidden>
        <span className="largo-orbit largo-orbit-1" />
        <span className="largo-orbit largo-orbit-2" />
        <span className="largo-orbit largo-orbit-3" />
        <span className="largo-neural-core" />
        <span className="largo-neural-ring" />
      </div>

      <div className="largo-thinking-copy">
        {/* kicker color is purple in globals.css → cyan brand override (Largo accent). */}
        <p className="largo-thinking-kicker text-secondary">Largo · working</p>
        <AnimatePresence mode="wait">
          <motion.p
            key={phrase}
            className="largo-status-phrase"
            initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={{ duration: 0.35 }}
          >
            {phrase}
          </motion.p>
        </AnimatePresence>

        <div className="largo-pipeline" aria-hidden>
          {PIPELINE_NODES.map((node, i) => (
            <span
              key={node.label}
              className={`largo-pipeline-node largo-pipeline-${node.color} ${
                i === activeNode ? "is-active" : i < activeNode ? "is-done" : ""
              }`}
            >
              <span className="largo-pipeline-dot" />
              {node.label}
            </span>
          ))}
        </div>

        {tools.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Live data sources">
            {tools.map((t, i) => {
              const isPulling = i === tools.length - 1;
              return (
                <span
                  key={t}
                  className={
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] " +
                    (isPulling
                      ? "border-cyan-400/45 bg-cyan-400/10 text-cyan-200"
                      : "border-bull/30 bg-bull/[0.07] text-bull")
                  }
                >
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full bg-current " +
                      (isPulling ? "animate-pulse motion-reduce:animate-none" : "")
                    }
                  />
                  {t}
                </span>
              );
            })}
          </div>
        )}

        <div className="largo-thinking-dots-row" aria-hidden>
          {Array.from({ length: 7 }).map((_, i) => (
            <span
              key={i}
              className="largo-thinking-dot-lg"
              style={{ animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
