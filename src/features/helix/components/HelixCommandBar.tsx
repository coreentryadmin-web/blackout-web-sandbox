"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";
import type { HelixDteFilter, HelixTableDensity } from "@/features/helix/lib/helix-table-columns";

const PREMIUM_PRESETS = [200_000, 500_000, 1_000_000, 20_000_000] as const;
const DTE_OPTIONS: { id: HelixDteFilter; label: string }[] = [
  { id: "all", label: "All DTE" },
  { id: "0dte", label: "0DTE" },
  { id: "week", label: "≤7d" },
  { id: "month+", label: ">7d" },
];
const DENSITY_OPTIONS: { id: HelixTableDensity; label: string }[] = [
  { id: "essential", label: "Essential" },
  { id: "standard", label: "Standard" },
  { id: "full", label: "Full" },
];

export type HelixTypeFilter = "ALL" | "CALL" | "PUT";

function ChipToggle({
  active,
  onClick,
  disabled,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  tone?: "gold" | "ember" | "sky" | "purple";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "helix-tape-chip",
        active && "helix-tape-chip--active",
        tone && active && `helix-tape-chip--${tone}`
      )}
    >
      {children}
    </button>
  );
}

export function HelixCommandBar({
  minPremium,
  onMinPremiumChange,
  typeFilter,
  onTypeFilterChange,
  callCount,
  putCount,
  allCount,
  tickerFilter,
  onTickerFilterChange,
  whalesOnly,
  onWhalesOnlyChange,
  dteFilter,
  onDteFilterChange,
  indicesOnly,
  onIndicesOnlyChange,
  watchlistOnly,
  onWatchlistOnlyChange,
  watchlistCount,
  density,
  onDensityChange,
  analyticsOpen,
  onAnalyticsOpenChange,
  replayMode,
  onReplayToggle,
  replaySpeed,
  onReplaySpeedChange,
  audioEnabled,
  onAudioToggle,
  onExportCsv,
  exportDisabled,
  loading,
  live,
  dataStale,
  displayCount,
  newestAgeLabel,
  replayDisabled,
}: {
  minPremium: number;
  onMinPremiumChange: (v: number) => void;
  typeFilter: HelixTypeFilter;
  onTypeFilterChange: (t: HelixTypeFilter) => void;
  callCount: number;
  putCount: number;
  allCount: number;
  tickerFilter: string;
  onTickerFilterChange: (t: string) => void;
  whalesOnly: boolean;
  onWhalesOnlyChange: (v: boolean) => void;
  dteFilter: HelixDteFilter;
  onDteFilterChange: (v: HelixDteFilter) => void;
  indicesOnly: boolean;
  onIndicesOnlyChange: (v: boolean) => void;
  watchlistOnly: boolean;
  onWatchlistOnlyChange: (v: boolean) => void;
  watchlistCount: number;
  density: HelixTableDensity;
  onDensityChange: (d: HelixTableDensity) => void;
  analyticsOpen: boolean;
  onAnalyticsOpenChange: (v: boolean) => void;
  replayMode: boolean;
  onReplayToggle: () => void;
  replaySpeed: number;
  onReplaySpeedChange: (s: number) => void;
  audioEnabled: boolean;
  onAudioToggle: () => void;
  onExportCsv: () => void;
  exportDisabled: boolean;
  loading: boolean;
  live: boolean;
  dataStale: boolean;
  displayCount: number;
  newestAgeLabel: string;
  replayDisabled: boolean;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <div className="helix-tape-bar">
      <div className="helix-tape-bar-primary">
        <div className="helix-tape-bar-block">
          <span className="helix-tape-bar-label">Floor</span>
          <div className="helix-tape-seg">
            {PREMIUM_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onMinPremiumChange(v)}
                className={clsx("helix-tape-seg-btn", minPremium === v && "helix-tape-seg-btn--active")}
              >
                {v >= 1_000_000 ? `$${v / 1_000_000}M` : `$${v / 1000}K`}
              </button>
            ))}
          </div>
        </div>

        <div className="helix-tape-bar-block">
          <span className="helix-tape-bar-label">Side</span>
          <div className="helix-tape-seg">
            {(["ALL", "CALL", "PUT"] as HelixTypeFilter[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTypeFilterChange(t)}
                className={clsx(
                  "helix-tape-seg-btn",
                  typeFilter === t && "helix-tape-seg-btn--active",
                  typeFilter === t && t === "CALL" && "helix-tape-seg-btn--call",
                  typeFilter === t && t === "PUT" && "helix-tape-seg-btn--put"
                )}
              >
                {t}
                <span className="helix-tape-seg-count">
                  {t === "CALL" ? callCount : t === "PUT" ? putCount : allCount}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="helix-tape-bar-block helix-tape-bar-search">
          <label className="helix-tape-bar-label" htmlFor="helix-ticker-search">
            Symbol
          </label>
          <div className="helix-tape-input-wrap">
            <input
              id="helix-ticker-search"
              value={tickerFilter}
              onChange={(e) => {
                const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
                onTickerFilterChange(val);
              }}
              placeholder="SPX"
              aria-label="Filter by ticker"
              maxLength={6}
              className="helix-tape-input"
            />
            {tickerFilter ? (
              <button
                type="button"
                onClick={() => onTickerFilterChange("")}
                className="helix-tape-input-clear"
                aria-label="Clear ticker filter"
              >
                ×
              </button>
            ) : null}
          </div>
        </div>

        <div className="helix-tape-bar-block helix-tape-bar-chips">
          <span className="helix-tape-bar-label">Quick</span>
          <div className="helix-tape-chips">
            <ChipToggle active={whalesOnly} onClick={() => onWhalesOnlyChange(!whalesOnly)} tone="purple">
              Whales
            </ChipToggle>
            <ChipToggle
              active={dteFilter === "0dte"}
              onClick={() => onDteFilterChange(dteFilter === "0dte" ? "all" : "0dte")}
              tone="ember"
            >
              0DTE
            </ChipToggle>
            <ChipToggle active={indicesOnly} onClick={() => onIndicesOnlyChange(!indicesOnly)} tone="sky">
              Indices
            </ChipToggle>
            <ChipToggle
              active={watchlistOnly}
              onClick={() => onWatchlistOnlyChange(!watchlistOnly)}
              disabled={watchlistCount === 0}
              tone="gold"
            >
              Watch{watchlistCount > 0 ? ` ${watchlistCount}` : ""}
            </ChipToggle>
          </div>
        </div>

        <div className="helix-tape-bar-spacer" />

        <div className="helix-tape-bar-block">
          <span className="helix-tape-bar-label">DTE</span>
          <div className="helix-tape-seg helix-tape-seg--compact">
            {DTE_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onDteFilterChange(o.id)}
                className={clsx(
                  "helix-tape-seg-btn helix-tape-seg-btn--compact",
                  dteFilter === o.id && "helix-tape-seg-btn--active"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="helix-tape-bar-block">
          <span className="helix-tape-bar-label">Cols</span>
          <div className="helix-tape-seg helix-tape-seg--compact">
            {DENSITY_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onDensityChange(o.id)}
                className={clsx(
                  "helix-tape-seg-btn helix-tape-seg-btn--compact",
                  density === o.id && "helix-tape-seg-btn--active"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onAnalyticsOpenChange(!analyticsOpen)}
          className={clsx("helix-tape-tool-btn", analyticsOpen && "helix-tape-tool-btn--active")}
          aria-pressed={analyticsOpen}
        >
          {analyticsOpen ? "Hide analytics" : "Analytics"}
        </button>

        <button
          type="button"
          onClick={() => setToolsOpen((v) => !v)}
          className={clsx("helix-tape-tool-btn", toolsOpen && "helix-tape-tool-btn--active")}
          aria-expanded={toolsOpen}
        >
          Tools
        </button>

        <div className="helix-tape-status" aria-live="polite">
          <span
            className={clsx(
              "helix-tape-status-dot",
              !live && "helix-tape-status-dot--off",
              live && dataStale && "helix-tape-status-dot--stale",
              live && !dataStale && "helix-tape-status-dot--live"
            )}
          />
          <div className="helix-tape-status-copy">
            <span className="helix-tape-status-label">
              {!live ? "Offline" : dataStale ? "Stale" : "Live"}
            </span>
            <span className="helix-tape-status-meta">
              {loading ? "Scanning…" : `${displayCount.toLocaleString()} · ${newestAgeLabel}`}
            </span>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {toolsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="helix-tape-bar-tools overflow-hidden"
          >
            <button
              type="button"
              onClick={onReplayToggle}
              disabled={replayDisabled}
              className={clsx("helix-tape-tool-btn", replayMode && "helix-tape-tool-btn--active")}
            >
              {replayMode ? "Stop replay" : "Replay"}
            </button>
            {replayMode &&
              [0.5, 1, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onReplaySpeedChange(s)}
                  className={clsx("helix-tape-tool-btn", replaySpeed === s && "helix-tape-tool-btn--active")}
                >
                  {s}×
                </button>
              ))}
            <button
              type="button"
              onClick={onAudioToggle}
              className={clsx("helix-tape-tool-btn", audioEnabled && "helix-tape-tool-btn--active")}
            >
              {audioEnabled ? "Audio on" : "Audio"}
            </button>
            <button
              type="button"
              onClick={onExportCsv}
              disabled={exportDisabled}
              className="helix-tape-tool-btn"
            >
              Export CSV
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
