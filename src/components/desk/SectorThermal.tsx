"use client";

import type { CSSProperties } from "react";
import { clsx } from "clsx";
import type { HeatmapData } from "@/lib/api";
import { fmtPct } from "@/lib/api";
import { DeskPanel } from "./DeskPanel";

export function SectorThermal({ data, live }: { data?: HeatmapData; live?: boolean }) {
  const sectors = data?.sectors ?? [];

  return (
    <DeskPanel title="Sector Thermal" subtitle="Polygon indices" variant="green" live={live} className="col-span-full">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2">
        {sectors.length === 0 ? (
          <p className="col-span-full text-cyan-400 text-sm font-mono py-6 text-center">
            {live ? "Loading sector data…" : "Connect engine for live sectors"}
          </p>
        ) : (
          sectors.map((s) => <ThermalCell key={s.name} name={s.name} change={s.change_pct} />)
        )}
      </div>
    </DeskPanel>
  );
}

export function MoversTape({ data, live }: { data?: HeatmapData; live?: boolean }) {
  const movers = data?.movers ?? [];

  return (
    <DeskPanel title="Top Movers" subtitle="Polygon stocks" variant="neutral" live={live}>
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {movers.length === 0 ? (
          <p className="text-cyan-400 text-sm font-mono py-6 text-center">No movers yet</p>
        ) : (
          movers.map((m) => (
            <div key={m.ticker} className="desk-mover-row">
              <span className="font-anton text-base text-white w-16">{m.ticker}</span>
              <span className="font-mono text-xs text-sky-300 flex-1">${m.price?.toFixed(2)}</span>
              <span className={clsx("font-mono text-sm font-bold tabular-nums", m.change_pct >= 0 ? "num-bull" : "num-bear")}>
                {fmtPct(m.change_pct)}
              </span>
            </div>
          ))
        )}
      </div>
    </DeskPanel>
  );
}

function ThermalCell({ name, change }: { name: string; change: number }) {
  const intensity = Math.min(1, Math.abs(change) / 2.5);
  const bull = change >= 0;

  return (
    <div
      className={clsx("desk-thermal-cell", bull ? "desk-thermal-bull" : "desk-thermal-bear")}
      style={{ "--heat": intensity } as CSSProperties}
    >
      <p className="text-[9px] font-mono uppercase tracking-wider text-sky-200 truncate">{name}</p>
      <p className={clsx("font-mono text-sm font-bold mt-1 tabular-nums", bull ? "text-bull" : "text-bear")}>
        {fmtPct(change)}
      </p>
    </div>
  );
}
