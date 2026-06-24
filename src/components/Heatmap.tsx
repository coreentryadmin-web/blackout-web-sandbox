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

  return (
    <div className="desk-layout space-y-5">
      <EngineStatusBar />

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
