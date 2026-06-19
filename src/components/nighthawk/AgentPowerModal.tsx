"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { defaultFiltersForMode, getAgentConfig } from "@/lib/nighthawk/agent-config";
import { postNightHawkHunt } from "@/lib/api";
import type { HuntMode, HuntResponse } from "@/lib/nighthawk/types";
import { AgentFilterFieldControl } from "./AgentFilterFields";

type AgentPowerModalProps = {
  mode: HuntMode | null;
  onClose: () => void;
};

type Step = "filters" | "powering" | "results";

export function AgentPowerModal({ mode, onClose }: AgentPowerModalProps) {
  const [step, setStep] = useState<Step>("filters");
  const [filters, setFilters] = useState<Record<string, string | number | boolean>>({});
  const [result, setResult] = useState<HuntResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = mode ? getAgentConfig(mode) : null;

  useEffect(() => {
    if (!mode) return;
    setStep("filters");
    setFilters(defaultFiltersForMode(mode));
    setResult(null);
    setError(null);
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  async function handlePowerUp() {
    if (!mode) return;
    setStep("powering");
    setError(null);
    try {
      const res = await postNightHawkHunt({ mode, filters });
      setResult(res);
      setStep("results");
    } catch {
      setError("Agent failed to arm. Try again.");
      setStep("filters");
    }
  }

  return (
    <AnimatePresence>
      {mode && config && (
        <motion.div
          className="nighthawk-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={clsx(
              "nighthawk-modal",
              config.accent === "gold" && "nighthawk-modal-gold",
              config.accent === "bear" && "nighthawk-modal-bear",
              config.accent === "purple" && "nighthawk-modal-purple"
            )}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="nighthawk-modal-title"
          >
            <header className="nighthawk-modal-header">
              <div>
                <p className="nighthawk-modal-kicker">{config.tagline}</p>
                <h2 id="nighthawk-modal-title" className="nighthawk-modal-title">
                  {config.title} agent
                </h2>
                <p className="nighthawk-modal-desc">{config.description}</p>
              </div>
              <button type="button" className="nighthawk-modal-close" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </header>

            {step === "filters" && (
              <div className="nighthawk-modal-body">
                <p className="nighthawk-modal-section-label">Configure filters</p>
                <div className="nighthawk-filter-grid">
                  {config.filters.map((field) => (
                    <AgentFilterFieldControl
                      key={field.id}
                      field={field}
                      value={filters[field.id] ?? field.defaultValue}
                      onChange={(val) => setFilters((prev) => ({ ...prev, [field.id]: val }))}
                    />
                  ))}
                </div>
                {error && <p className="nighthawk-modal-error">{error}</p>}
                <div className="nighthawk-modal-actions">
                  <button type="button" className="nighthawk-btn-ghost" onClick={onClose}>
                    Cancel
                  </button>
                  <button type="button" className="nighthawk-btn-power" onClick={handlePowerUp}>
                    {config.powerLabel}
                  </button>
                </div>
              </div>
            )}

            {step === "powering" && (
              <div className="nighthawk-modal-body nighthawk-modal-powering">
                <div className="nighthawk-power-ring" aria-hidden />
                <p className="nighthawk-power-title">Agent powering up…</p>
                <p className="nighthawk-power-copy">
                  Loading dossiers · scoring universe · applying {config.title.toLowerCase()} rules
                </p>
              </div>
            )}

            {step === "results" && result && (
              <div className="nighthawk-modal-body">
                <p className="nighthawk-modal-section-label">Scan status</p>
                <p className="nighthawk-result-message">{result.message}</p>
                {result.plays.length > 0 ? (
                  <ul className="nighthawk-result-plays">
                    {result.plays.map((play) => (
                      <li key={play.ticker} className="nighthawk-result-play">
                        <span className="nighthawk-result-ticker">{play.ticker}</span>
                        <span>{play.thesis}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="nighthawk-result-empty">
                    No qualifying plays matched your filters — try relaxing bias, DTE, or SPX alignment.
                  </p>
                )}
                <div className="nighthawk-modal-actions">
                  <button
                    type="button"
                    className="nighthawk-btn-ghost"
                    onClick={() => setStep("filters")}
                  >
                    Adjust filters
                  </button>
                  <button type="button" className="nighthawk-btn-power" onClick={onClose}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
