"use client";

import clsx from "clsx";
import {
  VECTOR_DTE_HORIZONS,
  dteHorizonLabel,
  type VectorDteHorizon,
} from "@/features/vector/lib/vector-dte-horizon";

type Props = {
  horizon: VectorDteHorizon;
  onHorizon: (h: VectorDteHorizon) => void;
  /** Only oracle tickers (SPX/SPY/QQQ) carry the per-expiry ladder that makes the
   *  horizon actually re-scope walls; hidden otherwise so the control never lies. */
  available: boolean;
  disabled?: boolean;
};

/** Compact DTE horizon selector — 0DTE / Weekly / Monthly.
 *  "All" was REMOVED from the member UI (user-directed, 2026-07-13): the blended all-expiry scope
 *  was the one whose definition drifted across surfaces/tasks (DTE grind findings) and it added no
 *  decision value over the narrowed horizons. The "all" horizon still exists in the type + APIs
 *  (SPX Slayer/BIE consume it); only the member-facing option is gone. */
export function VectorDteToggle({ horizon, onHorizon, available, disabled = false }: Props) {
  if (!available) return null;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Expiry horizon">
      {VECTOR_DTE_HORIZONS.filter((k) => k !== "all").map((key) => {
        const active = horizon === key;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onHorizon(key)}
            aria-pressed={active}
            data-testid={`vector-dte-${key}`}
            className={clsx(
              "font-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-lg border px-2 py-1.5 transition-colors",
              active && "border-emerald-400/70 bg-emerald-400/15 text-emerald-300",
              !active && !disabled && "border-white/15 text-cyan-400 hover:border-white/25",
              disabled && "cursor-not-allowed border-white/10 text-white/30"
            )}
          >
            {dteHorizonLabel(key)}
          </button>
        );
      })}
    </div>
  );
}
