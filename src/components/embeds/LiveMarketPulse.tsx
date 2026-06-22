"use client";

import useSWR from "swr";
import { fetchSpxState, fmtPct, fmtPrice, type SpxState } from "@/lib/api";
import { clsx } from "clsx";
import { EmbedFrame } from "./EmbedFrame";

type LiveMarketPulseProps = {
  compact?: boolean;
  className?: string;
};

function PulseBar({ label, value, bull }: { label: string; value: string; bull?: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-grey-800 last:border-0">
      <span className="font-mono text-[10px] tracking-widest uppercase text-sky-300">{label}</span>
      <span
        className={clsx(
          "font-mono text-sm font-semibold tabular-nums",
          bull === true ? "num-bull" : bull === false ? "num-bear" : "text-white"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function LiveMarketPulse({ compact, className }: LiveMarketPulseProps) {
  const { data } = useSWR<SpxState>("spx-merged-pulse", fetchSpxState, { refreshInterval: 3_000 });

  const live = data?.available;

  return (
    <EmbedFrame
      title="Market Pulse"
      subtitle={live ? "SPX Sniper Desk" : "Standby"}
      variant="pulse"
      className={className}
      live={live}
    >
      <div className={clsx("p-4", compact && "p-3")}>
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <p className="font-mono text-[9px] tracking-[0.4em] text-bull uppercase mb-1">SPX</p>
            <p className="font-anton text-4xl md:text-5xl text-white leading-none tabular-nums">
              {live ? fmtPrice(data.price, 2) : "— — —"}
            </p>
          </div>
          <div className="text-right">
            <p
              className={clsx(
                "font-mono text-lg font-bold tabular-nums",
                (data?.spx_change_pct ?? 0) >= 0 ? "num-bull" : "num-bear"
              )}
            >
              {live ? fmtPct(data.spx_change_pct) : "—"}
            </p>
            <p className="font-mono text-[10px] text-sky-300 mt-1">
              VIX {live && data.vix != null ? fmtPrice(data.vix, 2) : "—"}
            </p>
          </div>
        </div>

        <div className="embed-pulse-meter mb-4" aria-hidden>
          <div
            className="embed-pulse-meter-fill"
            style={{
              width: live
                ? `${Math.min(100, Math.max(8, 50 + (data.spx_change_pct ?? 0) * 8))}%`
                : "35%",
            }}
          />
        </div>

        <PulseBar
          label="VWAP"
          value={live ? fmtPrice(data.vwap) : "—"}
          bull={live ? data.above_vwap : null}
        />
        <PulseBar
          label="GEX Net"
          value={live ? (data.gex_net != null ? `$${(data.gex_net / 1e9).toFixed(2)}B` : "—") : "—"}
          bull={live && data.gex_net != null ? data.gex_net > 0 : null}
        />
        <PulseBar
          label="0DTE Flow"
          value={live && data.flow_0dte_net != null ? `$${(data.flow_0dte_net / 1e6).toFixed(1)}M` : "—"}
          bull={live && data.flow_0dte_net != null ? data.flow_0dte_net > 0 : null}
        />
        <PulseBar
          label="Regime"
          value={live ? (data.chart_levels.regime ?? "—") : "Standby"}
        />
      </div>
    </EmbedFrame>
  );
}
