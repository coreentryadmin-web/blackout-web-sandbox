"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export const LARGO_THINKING_PHRASES = [
  "Pulling the live tape…",
  "Reading dealer gamma…",
  "Cross-referencing flow against GEX…",
  "Pulling Polygon feeds…",
  "Scanning the 0DTE chain…",
  "Syncing the SPX Slayer desk…",
  "Running confluence on your ask…",
  "Tracking sweeps in the dark pool…",
  "Computing max-pain geometry…",
  "Stress-testing your thesis…",
  "Scoring the setup…",
  "Reading institutional positioning…",
  "Mapping gamma walls in real time…",
  "Parsing the order flow…",
  "Building the read…",
] as const;

const PIPELINE_NODES = [
  { label: "POLYGON", color: "cyan" },
  { label: "DESK", color: "green" },
  { label: "FLOW", color: "purple" },
  { label: "CLAUDE", color: "magenta" },
] as const;

type LargoThinkingStateProps = {
  active?: boolean;
};

export function LargoThinkingState({ active = true }: LargoThinkingStateProps) {
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

  const phrase = LARGO_THINKING_PHRASES[phraseIdx];
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
        <p className="largo-thinking-kicker text-cyan-300">◆ LARGO · WORKING</p>
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
