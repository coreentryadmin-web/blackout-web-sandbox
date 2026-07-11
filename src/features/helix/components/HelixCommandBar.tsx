"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";

const PREMIUM_PRESETS = [200_000, 500_000, 1_000_000, 20_000_000] as const;

export type HelixTypeFilter = "ALL" | "CALL" | "PUT";
export type HelixTapeView = "table" | "cards";

export function HelixCommandBar({
  tapeView,
  onTapeViewChange,
  minPremium,
  onMinPremiumChange,
  typeFilter,
  onTypeFilterChange,
  callCount,
  putCount,
  allCount,
  tickerFilter,
  onTickerFilterChange,
  watchlistOnly,
  onWatchlistOnlyChange,
  watchlistCount,
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
  tapeView: HelixTapeView;
  onTapeViewChange: (v: HelixTapeView) => void;
  minPremium: number;
  onMinPremiumChange: (v: number) => void;
  typeFilter: HelixTypeFilter;
  onTypeFilterChange: (t: HelixTypeFilter) => void;
  callCount: number;
  putCount: number;
  allCount: number;
  tickerFilter: string;
  onTickerFilterChange: (t: string) => void;
  watchlistOnly: boolean;
  onWatchlistOnlyChange: (v: boolean) => void;
  watchlistCount: number;
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
    <div className="helix-pro-command">
      <div className="helix-pro-command-primary">
        <div className="helix-pro-command-group">
          <span className="helix-pro-command-label">View</span>
          <div className="helix-pro-seg">
            {(["table", "cards"] as HelixTapeView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onTapeViewChange(v)}
                className={clsx("helix-pro-seg-btn", tapeView === v && "helix-pro-seg-btn--active")}
              >
                {v === "table" ? "Table" : "Cards"}
              </button>
            ))}
          </div>
        </div>

        <div className="helix-pro-command-group">
          <span className="helix-pro-command-label">Floor</span>
          <div className="helix-pro-seg">
            {PREMIUM_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onMinPremiumChange(v)}
                className={clsx("helix-pro-seg-btn", minPremium === v && "helix-pro-seg-btn--active")}
              >
                {v >= 1_000_000 ? `$${v / 1_000_000}M` : `$${v / 1000}K`}
              </button>
            ))}
          </div>
        </div>

        <div className="helix-pro-command-group">
          <span className="helix-pro-command-label">Side</span>
          <div className="helix-pro-seg">
            {(["ALL", "CALL", "PUT"] as HelixTypeFilter[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTypeFilterChange(t)}
                className={clsx(
                  "helix-pro-seg-btn",
                  typeFilter === t && "helix-pro-seg-btn--active",
                  typeFilter === t && t === "CALL" && "helix-pro-seg-btn--call",
                  typeFilter === t && t === "PUT" && "helix-pro-seg-btn--put"
                )}
              >
                {t}
                <span className="helix-pro-count">
                  {t === "CALL" ? callCount : t === "PUT" ? putCount : allCount}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="helix-pro-command-group helix-pro-command-search">
          <label className="helix-pro-command-label" htmlFor="helix-ticker-search">
            Symbol
          </label>
          <div className="helix-pro-input-wrap">
            <input
              id="helix-ticker-search"
              value={tickerFilter}
              onChange={(e) => {
                const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
                onTickerFilterChange(val);
              }}
              placeholder="Filter"
              aria-label="Filter by ticker"
              maxLength={6}
              className="helix-pro-input"
            />
            {tickerFilter ? (
              <button
                type="button"
                onClick={() => onTickerFilterChange("")}
                className="helix-pro-input-clear"
                aria-label="Clear ticker filter"
              >
                ×
              </button>
            ) : null}
          </div>
        </div>

        <div className="helix-pro-command-spacer" />

        <button
          type="button"
          onClick={() => setToolsOpen((v) => !v)}
          className={clsx("helix-pro-tool-btn", toolsOpen && "helix-pro-tool-btn--active")}
          aria-expanded={toolsOpen}
        >
          Tools
        </button>

        <div className="helix-pro-status" aria-live="polite">
          <span
            className={clsx(
              "helix-pro-status-dot",
              !live && "helix-pro-status-dot--off",
              live && dataStale && "helix-pro-status-dot--stale",
              live && !dataStale && "helix-pro-status-dot--live"
            )}
          />
          <div className="helix-pro-status-copy">
            <span className="helix-pro-status-label">
              {!live ? "Offline" : dataStale ? "Stale" : "Live"}
            </span>
            <span className="helix-pro-status-meta">
              {loading ? "Scanning…" : `${displayCount} prints · ${newestAgeLabel}`}
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
            className="helix-pro-command-tools overflow-hidden"
          >
            <button
              type="button"
              onClick={onReplayToggle}
              disabled={replayDisabled}
              className={clsx("helix-pro-tool-btn", replayMode && "helix-pro-tool-btn--active")}
            >
              {replayMode ? "Stop replay" : "Replay"}
            </button>
            {replayMode &&
              [0.5, 1, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onReplaySpeedChange(s)}
                  className={clsx("helix-pro-tool-btn", replaySpeed === s && "helix-pro-tool-btn--active")}
                >
                  {s}×
                </button>
              ))}
            <button
              type="button"
              onClick={onAudioToggle}
              className={clsx("helix-pro-tool-btn", audioEnabled && "helix-pro-tool-btn--active")}
            >
              {audioEnabled ? "Audio on" : "Audio"}
            </button>
            <button
              type="button"
              onClick={() => onWatchlistOnlyChange(!watchlistOnly)}
              disabled={watchlistCount === 0}
              className={clsx("helix-pro-tool-btn", watchlistOnly && "helix-pro-tool-btn--active")}
            >
              Watchlist{watchlistCount > 0 ? ` (${watchlistCount})` : ""}
            </button>
            <button
              type="button"
              onClick={onExportCsv}
              disabled={exportDisabled}
              className="helix-pro-tool-btn"
            >
              Export CSV
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
