"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Button, Modal } from "@/components/ui";
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

  async function handlePowerUp() {
    if (!mode) return;
    setStep("powering");
    setError(null);
    try {
      const res = await postNightHawkHunt({ mode, filters });
      setResult(res);
      setStep("results");
    } catch {
      setError("Agent failed to arm. Re-arm to retry.");
      setStep("filters");
    }
  }

  const header = config && (
    <div>
      <p className="nighthawk-modal-kicker">{config.tagline}</p>
      <h2 id="nighthawk-modal-title" className="nighthawk-modal-title">
        {config.title} agent
      </h2>
      <p className="nighthawk-modal-desc">{config.description}</p>
    </div>
  );

  return (
    <Modal
      open={!!(mode && config)}
      onClose={onClose}
      title={header}
      className={clsx(
        "nighthawk-modal",
        config?.accent === "gold" && "nighthawk-modal-gold",
        config?.accent === "bear" && "nighthawk-modal-bear",
        config?.accent === "purple" && "nighthawk-modal-purple"
      )}
    >
      {config && (
        <>
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
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <button type="button" className="nighthawk-btn-power" onClick={handlePowerUp}>
                  {config.powerLabel}
                </button>
              </div>
            </div>
          )}

          {step === "powering" && (
            <div className="nighthawk-modal-body nighthawk-modal-powering">
              <div className="nighthawk-power-ring" aria-hidden />
              <p className="nighthawk-power-title">Agent arming…</p>
              <p className="nighthawk-power-copy">
                Building dossiers · scoring the universe · applying {config.title.toLowerCase()} rules
              </p>
            </div>
          )}

          {step === "results" && result && (
            <div className="nighthawk-modal-body">
              <p className="nighthawk-modal-section-label">Scan status</p>
              <p className="nighthawk-result-message">{result.message}</p>
              {result.plays.length > 0 ? (
                <ul className="nighthawk-result-plays">
                  {result.plays.map((play, idx) => (
                    <li key={`${play.ticker}-${play.contract ?? idx}`} className="nighthawk-result-play">
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
                <Button variant="ghost" size="sm" onClick={() => setStep("filters")}>
                  Adjust filters
                </Button>
                <button type="button" className="nighthawk-btn-power" onClick={onClose}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
