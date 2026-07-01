"use client";

import useSWR from "swr";
import { fetchPlatformHealth } from "@/lib/api";
import { clsx } from "clsx";
import { usePollIntervalMs } from "@/hooks/use-et-market-open";

export function EngineStatusBar() {
  const pollMs = usePollIntervalMs(25_000, 120_000);
  const { data } = useSWR("platform-health", fetchPlatformHealth, {
    refreshInterval: pollMs,
    refreshWhenHidden: false,
  });

  const marketOn = data?.market?.ok === true;
  const intelOn = data?.intel?.ok === true;
  const polygon = data?.market?.polygon;
  const uw = data?.market?.unusual_whales;

  return (
    <div className="engine-status-bar">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={clsx(
            "engine-status-dot",
            marketOn ? "engine-status-online" : "engine-status-offline"
          )}
        />
        <span className="font-mono text-[10px] tracking-[0.35em] uppercase text-sky-100">
          BlackOut Data Desk
        </span>
        <span className="font-mono text-[10px] text-cyan-400 hidden sm:inline">
          {marketOn
            ? `${polygon && uw ? "Indices · flow live" : polygon ? "Indices live" : uw ? "Flow live" : "Market live"}`
            : "Market feed offline — reconnecting"}
        </span>
        {intelOn && (
          <span className="font-mono text-[10px] tracking-widest uppercase text-bull/80 border border-bull/30 px-2 py-0.5">
            + Intel layer
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 font-mono text-[10px] tracking-widest uppercase text-cyan-400">
        <span className={marketOn ? "text-bull/80" : ""}>Market APIs</span>
        <span className={intelOn ? "text-purple-light/80" : ""}>BlackOut Engine</span>
      </div>
    </div>
  );
}
