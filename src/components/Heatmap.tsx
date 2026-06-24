"use client";

import useSWR from "swr";
import { fetchHeatmap, type HeatmapData } from "@/lib/api";
import { EngineStatusBar } from "@/components/desk/EngineStatusBar";
import { SectorThermal, MoversTape } from "@/components/desk/SectorThermal";
import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";
import { EmptyState, Skeleton } from "@/components/ui";

export function Heatmap() {
  const { data, isLoading, error } = useSWR<HeatmapData>("heatmap", fetchHeatmap, {
    refreshInterval: 45_000,
  });

  const live = !error && Boolean(data);
  const empty = !isLoading && (data?.sectors?.length ?? 0) === 0 && (data?.movers?.length ?? 0) === 0;
  // Distinguish a fetch FAILURE from a genuinely-idle (connected but empty) feed.
  // Any cached `data` SWR still holds stays rendered below — we never blank it on error.
  const fetchFailed = Boolean(error) && !isLoading;

  return (
    <div className="desk-layout space-y-5">
      <EngineStatusBar />

      {fetchFailed && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-bear/40 bg-bear/[0.08] px-4 py-3"
          style={{ boxShadow: "inset 0 0 16px rgba(255,45,85,0.06)" }}
        >
          <span className="text-bear text-sm leading-none">⚠</span>
          <span className="font-mono text-[12px] font-bold text-bear tracking-wide">
            Feed unavailable — retrying
          </span>
        </div>
      )}

      {empty ? (
        <EmptyState
          icon="◆"
          title="THERMAL IDLE"
          description="Sector rotation goes live during RTH, the moment the feed prints. Standby until the bell."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8 xl:col-span-8">
            <SectorThermal data={data} live={live} />
          </div>
          <div className="lg:col-span-4 xl:col-span-4 space-y-4">
            <MoversTape data={data} live={live} />
            <TradingViewWidget type="market-overview" title="Indices" height={280} />
          </div>
        </div>
      )}

      {isLoading && (
        <div className="desk-skeleton-grid" aria-hidden>
          <Skeleton height={192} rounded="2xl" />
          <Skeleton height={256} rounded="2xl" />
        </div>
      )}
    </div>
  );
}
