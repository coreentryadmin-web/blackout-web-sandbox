"use client";

import useSWR from "swr";
import { fetchSpxState, fmtPct, fmtPremium, fmtPrice, type SpxState } from "@/lib/api";
import { clsx } from "clsx";
import { EmbedFrame } from "./EmbedFrame";
import { Skeleton } from "@/components/ui";

type LiveMarketPulseProps = {
  compact?: boolean;
  className?: string;
};

function PulseBar({
  label,
  value,
  bull,
  loading,
}: {
  label: string;
  value: string;
  bull?: boolean | null;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/10 last:border-0">
      <span className="font-mono text-[10px] tracking-widest uppercase text-sky-300">{label}</span>
      {loading ? (
        <Skeleton width={64} height={14} rounded="sm" />
      ) : (
        <span
          className={clsx(
            "font-mono text-sm font-semibold tabular-nums",
            bull === true ? "num-bull" : bull === false ? "num-bear" : "text-white"
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}

export function LiveMarketPulse({ compact, className }: LiveMarketPulseProps) {
  const { data } = useSWR<SpxState>("spx-merged-pulse", fetchSpxState, { refreshInterval: 3_000 });

  const live = data?.available;
  // No data yet on first paint → render neutral skeletons instead of flashing
  // em-dashes (which read as a real "Standby" state once the feed is settled).
  const isLoading = data === undefined;

  return (
    <EmbedFrame
      title="Market Pulse"
      subtitle={isLoading ? "Connecting" : live ? "SPX Slayer Desk" : "Standby"}
      variant="pulse"
      className={className}
      live={live}
    >
      <div className={clsx("p-4", compact && "p-3")}>
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.4em] text-bull uppercase mb-1">SPX</p>
            {isLoading ? (
              <Skeleton width={170} height={44} rounded="md" />
            ) : (
              <p className="font-anton text-4xl md:text-5xl text-white leading-none tabular-nums">
                {live ? fmtPrice(data.price, 2) : "— — —"}
              </p>
            )}
          </div>
          <div className="text-right">
            {isLoading ? (
              <div className="flex flex-col items-end gap-1.5">
                <Skeleton width={64} height={18} rounded="sm" />
                <Skeleton width={52} height={12} rounded="sm" />
              </div>
            ) : (
              <>
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
              </>
            )}
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
          loading={isLoading}
        />
        <PulseBar
          label="GEX Net"
          value={live && data.gex_net != null ? fmtPremium(data.gex_net) : "—"}
          bull={live && data.gex_net != null ? data.gex_net > 0 : null}
          loading={isLoading}
        />
        <PulseBar
          label="0DTE Flow"
          value={live && data.flow_0dte_net != null ? fmtPremium(data.flow_0dte_net) : "—"}
          bull={live && data.flow_0dte_net != null ? data.flow_0dte_net > 0 : null}
          loading={isLoading}
        />
        <PulseBar
          label="Regime"
          value={live ? (data.chart_levels.regime ?? "—") : "Standby"}
          loading={isLoading}
        />
      </div>
    </EmbedFrame>
  );
}
