"use client";

import type { CSSProperties } from "react";
import { clsx } from "clsx";
import type { HeatmapData } from "@/lib/api";
import { fmtPct } from "@/lib/api";
import { Panel, Badge } from "@/components/ui";

/** Live / offline status pill — mirrors the legacy DeskPanel `live` indicator. */
function FeedBadge({ live }: { live?: boolean }) {
  return live ? (
    <Badge tone="bull" dot>
      Live
    </Badge>
  ) : (
    <Badge tone="neutral">Offline</Badge>
  );
}

export function SectorThermal({ data, live }: { data?: HeatmapData; live?: boolean }) {
  const sectors = data?.sectors ?? [];

  return (
    <Panel
      accent="accent"
      kicker="Polygon indices"
      title="Sector Thermal"
      actions={<FeedBadge live={live} />}
      className="col-span-full"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2">
        {sectors.length === 0 ? (
          <p className="col-span-full text-cyan-400 text-sm font-mono py-6 text-center">
            {live ? "Acquiring sector rotation…" : "Feed offline — sectors go live at the bell"}
          </p>
        ) : (
          sectors.map((s) => <ThermalCell key={s.name} name={s.name} change={s.change_pct} />)
        )}
      </div>
    </Panel>
  );
}

export function MoversTape({ data, live }: { data?: HeatmapData; live?: boolean }) {
  const movers = data?.movers ?? [];

  return (
    <Panel accent="sky" kicker="Polygon stocks" title="Top Movers" actions={<FeedBadge live={live} />}>
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {movers.length === 0 ? (
          <p className="text-cyan-400 text-sm font-mono py-6 text-center">No movers on the board yet</p>
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
    </Panel>
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
