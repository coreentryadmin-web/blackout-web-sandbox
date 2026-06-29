"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Button, EmptyState, useFocusTrap } from "@/components/ui";
import { defaultFiltersForMode, getAgentConfig } from "@/lib/nighthawk/agent-config";
import { postNightHawkHunt } from "@/lib/api";
import type { HuntPlay, HuntResponse } from "@/lib/nighthawk/types";
import { AgentFilterFieldControl } from "./AgentFilterFields";
import { DayTradeSignalCard } from "./DayTradeSignalCard";

type DayTradeAgentWorkspaceProps = {
  open: boolean;
  onClose: () => void;
};

type WorkspaceStep = "configure" | "arming" | "live";

const ARMING_PHASES = [
  { id: "context", label: "Ingesting live market-wide context", detail: "SPX · VIX · sector tides · flow tape" },
  { id: "candidates", label: "Mining flow candidates", detail: "UW sweeps · hot chains · watchlist merge" },
  { id: "dossiers", label: "Building ticker dossiers", detail: "Technicals · GEX · dark pool · news" },
  { id: "score", label: "Scoring & ranking universe", detail: "Day weights · liquidity · conviction gates" },
  { id: "synth", label: "Contract synthesis", detail: "ATM chains · strike validation · premium cap" },
  { id: "align", label: "SPX alignment filter", detail: "Desk bias · 0DTE contract filter" },
] as const;

const CAPABILITIES = [
  "Live flow and technical dossiers across the full candidate universe",
  "0–1 DTE contract synthesis with real chain strikes and a $20/share premium cap",
  "SPX desk alignment — drops setups fighting gamma, tide, or 0DTE flow",
  "Validated strikes only — unverified contracts are rejected before they surface",
];

function filterChipLabel(id: string, value: string | number | boolean): string {
  if (id === "direction") {
    if (value === "bull") return "Bullish bias";
    if (value === "bear") return "Bearish bias";
    return "Any direction";
  }
  if (id === "max_dte") return value === "0" || value === 0 ? "0DTE only" : "0–1 DTE";
  if (id === "min_premium") {
    const n = Number(value);
    if (n >= 1_000_000) return "$1M+ flow";
    if (n >= 500_000) return "$500K+ flow";
    if (n >= 250_000) return "$250K+ flow";
    return `$${(n / 1000).toFixed(0)}K+ flow`;
  }
  if (id === "spx_context") return value ? "SPX aligned" : "SPX filter off";
  if (id === "watchlist" && String(value).trim()) {
    return `Watch: ${String(value).trim().slice(0, 24)}${String(value).length > 24 ? "…" : ""}`;
  }
  return "";
}

export function DayTradeAgentWorkspace({ open, onClose }: DayTradeAgentWorkspaceProps) {
  const config = getAgentConfig("day");
  const [step, setStep] = useState<WorkspaceStep>("configure");
  const [filters, setFilters] = useState<Record<string, string | number | boolean>>(() =>
    defaultFiltersForMode("day")
  );
  const [armingPhase, setArmingPhase] = useState(0);
  const [result, setResult] = useState<HuntResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setStep("configure");
    setFilters(defaultFiltersForMode("day"));
    setArmingPhase(0);
    setResult(null);
    setError(null);
    setSelectedTicker(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open, reset]);

  // Focus trap + Esc + return-focus for the full-screen takeover. Esc is a
  // no-op while arming (matches the prior step-conditional handler). The
  // workspace owns the whole viewport, so no body scroll-lock is introduced.
  useFocusTrap(workspaceRef, {
    active: open,
    onEscape: step !== "arming" ? onClose : undefined,
    lockScroll: false,
  });

  useEffect(() => {
    if (step !== "arming") return;
    const timer = window.setInterval(() => {
      setArmingPhase((p) => Math.min(p + 1, ARMING_PHASES.length - 1));
    }, 4200);
    return () => window.clearInterval(timer);
  }, [step]);

  const filterChips = useMemo(
    () =>
      config.filters
        .map((f) => filterChipLabel(f.id, filters[f.id] ?? f.defaultValue))
        .filter(Boolean),
    [config.filters, filters]
  );

  const selectedPlay = useMemo(
    () => result?.plays.find((p) => p.ticker === selectedTicker) ?? null,
    [result?.plays, selectedTicker]
  );

  async function handlePowerUp() {
    setStep("arming");
    setArmingPhase(0);
    setError(null);
    setResult(null);
    setSelectedTicker(null);
    try {
      const res = await postNightHawkHunt({ mode: "day", filters });
      setResult(res);
      setArmingPhase(ARMING_PHASES.length - 1);
      setStep("live");
      if (res.plays[0]) setSelectedTicker(res.plays[0].ticker);
    } catch {
      setError("Day Hawk failed to arm. Check the connection and re-arm.");
      setStep("configure");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={workspaceRef}
          className="dayhawk-workspace outline-none"
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dayhawk-workspace-title"
        >
          <header className="dayhawk-workspace-header">
            <div>
              <p className="dayhawk-workspace-kicker">{config.tagline}</p>
              <h1 id="dayhawk-workspace-title" className="dayhawk-workspace-title">
                Day Hawk
              </h1>
              <p className="dayhawk-workspace-sub">
                Intraday analysis · flow dossiers · live 0DTE chains
              </p>
            </div>
            <div className="dayhawk-workspace-header-actions">
              {step === "live" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep("configure");
                    setResult(null);
                  }}
                >
                  Re-arm
                </Button>
              )}
              <button
                type="button"
                className="dayhawk-workspace-close"
                onClick={onClose}
                disabled={step === "arming"}
                aria-label="Close Day Hawk workspace"
              >
                ✕
              </button>
            </div>
          </header>

          {step === "configure" && (
            <div className="dayhawk-workspace-body dayhawk-workspace-configure">
              <section className="dayhawk-config-panel">
                <p className="nighthawk-modal-section-label">Mission parameters</p>
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
                <div className="dayhawk-config-actions">
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handlePowerUp}
                    className="border-gold/50 bg-gradient-to-b from-gold to-[#e0b417] text-black shadow-[0_0_30px_-10px_rgba(255,210,63,0.7)] hover:shadow-[0_0_40px_-8px_rgba(255,210,63,0.85)]"
                  >
                    {config.powerLabel}
                  </Button>
                </div>
              </section>

              <aside className="dayhawk-brief-panel">
                <p className="nighthawk-modal-section-label">Agent capabilities</p>
                <ul className="dayhawk-cap-list">
                  {CAPABILITIES.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="nighthawk-modal-section-label dayhawk-brief-divider">Active profile</p>
                <div className="dayhawk-chip-row">
                  {filterChips.map((chip) => (
                    <span key={chip} className="dayhawk-chip">
                      {chip}
                    </span>
                  ))}
                </div>
                <p className="dayhawk-brief-foot">
                  Opens a dedicated command surface. Scan runs the full Night Hawk pipeline with
                  day-trade weights — typically 60–120 seconds.
                </p>
              </aside>
            </div>
          )}

          {step === "arming" && (
            <div className="dayhawk-workspace-body dayhawk-workspace-arming">
              <div className="dayhawk-arm-core">
                <div className="dayhawk-arm-ring" aria-hidden />
                <div className="dayhawk-arm-ring dayhawk-arm-ring-2" aria-hidden />
                <p className="dayhawk-arm-title">Agent arming</p>
                <p className="dayhawk-arm-copy">Day Hawk is running the live scan pipeline…</p>
              </div>
              <ol className="dayhawk-arm-phases">
                {ARMING_PHASES.map((phase, i) => (
                  <li
                    key={phase.id}
                    className={clsx(
                      "dayhawk-arm-phase",
                      i < armingPhase && "dayhawk-arm-phase-done",
                      i === armingPhase && "dayhawk-arm-phase-active"
                    )}
                  >
                    <span className="dayhawk-arm-phase-dot" />
                    <div>
                      <p>{phase.label}</p>
                      <span>{phase.detail}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {step === "live" && result && (
            <div className="dayhawk-workspace-body dayhawk-workspace-live">
              <div className="dayhawk-live-meta">
                <div className="dayhawk-live-stats">
                  <span>
                    <em>Signals</em> {result.plays.length}
                  </span>
                  <span>
                    <em>Scanned</em> {result.scan_meta?.candidates ?? "—"} candidates
                  </span>
                  <span>
                    <em>Runtime</em>{" "}
                    {result.scan_meta?.duration_ms != null
                      ? `${(result.scan_meta.duration_ms / 1000).toFixed(1)}s`
                      : "—"}
                  </span>
                  <span>
                    <em>SPX bias</em> {result.platform_context?.spx_bias ?? "neutral"}
                  </span>
                </div>
                <p className="dayhawk-live-message">{result.message}</p>
                <div className="dayhawk-chip-row">
                  {filterChips.map((chip) => (
                    <span key={chip} className="dayhawk-chip">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>

              {result.plays.length > 0 ? (
                <div className="dayhawk-live-grid">
                  <div className="dayhawk-signal-list">
                    {result.plays.map((play, i) => (
                      <DayTradeSignalCard
                        key={`${play.ticker}-${i}`}
                        play={play}
                        rank={i + 1}
                        selected={selectedTicker === play.ticker}
                        onSelect={() => setSelectedTicker(play.ticker)}
                      />
                    ))}
                  </div>
                  <aside className="dayhawk-signal-detail">
                    {selectedPlay ? (
                      <SignalDetailPanel play={selectedPlay} />
                    ) : (
                      <p className="dayhawk-signal-detail-empty">Select a signal for the full dossier</p>
                    )}
                  </aside>
                </div>
              ) : (
                <EmptyState
                  className="dayhawk-live-empty !border-bear/25 !bg-transparent"
                  title="No qualifying signals"
                  description="Nothing surfaced this scan. Relax SPX alignment, widen DTE, or lower the flow premium floor."
                  action={
                    <Button
                      size="sm"
                      onClick={() => setStep("configure")}
                      className="border-gold/50 bg-gradient-to-b from-gold to-[#e0b417] text-black shadow-[0_0_30px_-10px_rgba(255,210,63,0.7)] hover:shadow-[0_0_40px_-8px_rgba(255,210,63,0.85)]"
                    >
                      Adjust parameters
                    </Button>
                  }
                />
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function signalTone(direction: string): "bull" | "bear" | "neutral" {
  const d = direction.toUpperCase();
  if (d.includes("LONG") || d.includes("BULL") || d.includes("CALL")) return "bull";
  if (d.includes("SHORT") || d.includes("BEAR") || d.includes("PUT")) return "bear";
  return "neutral";
}

function SignalDetailPanel({ play }: { play: HuntPlay }) {
  const tone = signalTone(play.direction);
  return (
    <div className="dayhawk-detail-inner">
      <header>
        <h2>{play.ticker}</h2>
        <span className={clsx("dayhawk-signal-direction", `dayhawk-signal-direction-${tone}`)}>
          {play.direction}
        </span>
        <span className="dayhawk-detail-score">Score {play.score != null ? play.score : "—"}</span>
      </header>
      <p className="dayhawk-detail-thesis">{play.thesis}</p>
      <dl className="dayhawk-detail-levels">
        <div>
          <dt>Entry</dt>
          <dd>{play.entry}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{play.target}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd>{play.stop}</dd>
        </div>
      </dl>
      <div className="dayhawk-detail-contract">
        <p className="nighthawk-modal-section-label">Contract</p>
        <p>{play.contract}</p>
      </div>
      <div className="dayhawk-detail-flags">
        {play.spx_aligned != null && (
          <span className={clsx("dayhawk-chip", play.spx_aligned && "dayhawk-chip-ok")}>
            SPX {play.spx_aligned ? "aligned" : "misaligned"}
          </span>
        )}
        <span className="dayhawk-chip">Phase · {play.phase ?? "CANDIDATE"}</span>
      </div>
    </div>
  );
}
