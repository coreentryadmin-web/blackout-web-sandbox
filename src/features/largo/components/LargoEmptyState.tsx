"use client";

import { motion } from "framer-motion";
import { ProductMark } from "@/components/marks/ProductMark";
import { LARGO_EXAMPLE_PROMPTS } from "@/hooks/useLargoChat";

/**
 * Commanding empty state for the full-page terminal (BIE Master Spec §6 —
 * "Not a small chat box"). Presents Largo as the platform's decision-intelligence
 * surface with example prompts spanning the engine's intent range, so the member's
 * first impression is capability, not a blank input.
 */
export function LargoEmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <motion.div
      className="largo-empty"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="largo-empty-hero">
        <ProductMark product="largo" size={44} />
        <h2 className="largo-empty-title">Ask the desk anything.</h2>
        <p className="largo-empty-lead">
          Largo is the decision-intelligence engine behind BlackOut — it pulls live platform
          data on every question, separates fact from inference, and shows its sources.
        </p>
      </div>

      <p className="largo-empty-label">Try one of these</p>
      <div className="largo-empty-grid">
        {LARGO_EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="largo-empty-card"
            onClick={() => onPick(p.label)}
          >
            <span className="largo-empty-card-q">{p.label}</span>
            <span className="largo-empty-card-hint">{p.hint}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
