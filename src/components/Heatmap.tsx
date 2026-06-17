"use client";

import useSWR from "swr";
import { fetchHeatmap, fmtPct, type HeatmapData } from "@/lib/api";
import { clsx } from "clsx";
import { PlatformEmpty } from "@/components/platform/PlatformEmpty";
import { HeatmapEmbeds } from "@/components/embeds/HeatmapEmbeds";

function heatColor(pct: number): string {
  const abs = Math.min(Math.abs(pct), 5);
  const intensity = abs / 5;
  if (pct > 0) {
    const g = Math.round(40 + intensity * 100);
    return `rgba(34,${g + 90},34,${0.15 + intensity * 0.5})`;
  } else {
    const r = Math.round(120 + intensity * 100);
    return `rgba(${r + 80},34,34,${0.15 + intensity * 0.5})`;
  }
}

function SectorCell({ name, change_pct }: { name: string; change_pct: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center p-4 border border-surface-2 cursor-default transition-all hover:scale-[1.02]"
      style={{ background: heatColor(change_pct), minHeight: 80 }}
    >
      <span className="text-[11px] tracking-[1px] text-text-primary text-center leading-tight mb-1">{name}</span>
      <span className={clsx("font-mono text-[14px] font-semibold", change_pct >= 0 ? "num-bull" : "num-bear")}>
        {fmtPct(change_pct)}
      </span>
    </div>
  );
}

function MoverCell({ ticker, change_pct, price }: { ticker: string; change_pct: number; price: number }) {
  const size = Math.max(60, Math.min(140, 60 + Math.abs(change_pct) * 15));
  return (
    <div
      className="flex flex-col items-center justify-center border border-surface-2 cursor-default hover:scale-[1.03] transition-all"
      style={{ background: heatColor(change_pct), height: size, width: size }}
    >
      <span className="font-mono text-[12px] font-bold text-white">{ticker}</span>
      <span className={clsx("font-mono text-[11px]", change_pct >= 0 ? "num-bull" : "num-bear")}>
        {fmtPct(change_pct)}
      </span>
    </div>
  );
}

export function Heatmap() {
  const { data, isLoading } = useSWR<HeatmapData>("heatmap", fetchHeatmap, { refreshInterval: 60_000 });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <HeatmapEmbeds />
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-5 gap-px bg-surface-2 h-48" />
          <div className="h-64 bg-surface-1" />
        </div>
      </div>
    );
  }

  const sectors = data?.sectors ?? [];
  const movers = data?.movers ?? [];
  const gainers = movers.filter((m) => m.change_pct >= 0).sort((a, b) => b.change_pct - a.change_pct).slice(0, 20);
  const losers = movers.filter((m) => m.change_pct < 0).sort((a, b) => a.change_pct - b.change_pct).slice(0, 20);

  return (
    <div className="space-y-8">
      <HeatmapEmbeds />
      {/* Sector heatmap */}
      <div>
        <p className="text-[10px] tracking-[3px] uppercase text-text-muted mb-4">Sector Performance</p>
        {sectors.length === 0 ? (
          <PlatformEmpty
            variant="heatmap"
            title="THERMAL IDLE"
            description="Sector heatmaps light up during RTH when rotation data is live. Check back when the bell rings."
          />
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-5 gap-px bg-surface-2">
            {sectors.map((s) => (
              <SectorCell key={s.name} name={s.name} change_pct={s.change_pct} />
            ))}
          </div>
        )}
      </div>

      {/* Stock movers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <p className="text-[10px] tracking-[3px] uppercase text-text-muted mb-4">Top Gainers</p>
          {gainers.length === 0 ? (
            <div className="card p-6 text-center text-text-muted text-[13px]">No data</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {gainers.map((m) => (
                <MoverCell key={m.ticker} ticker={m.ticker} change_pct={m.change_pct} price={m.price} />
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-[10px] tracking-[3px] uppercase text-text-muted mb-4">Top Losers</p>
          {losers.length === 0 ? (
            <div className="card p-6 text-center text-text-muted text-[13px]">No data</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {losers.map((m) => (
                <MoverCell key={m.ticker} ticker={m.ticker} change_pct={m.change_pct} price={m.price} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
