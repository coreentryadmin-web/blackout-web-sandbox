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
      accent="ember"
      kicker="Polygon indices"
      title="Sector Thermal"
      actions={<FeedBadge live={live} />}
      className="col-span-full"
    >
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2"
        role="status"
        aria-live="polite"
        aria-label="Sector rotation heatmap"
      >
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
      <div
        className="space-y-1 max-h-[400px] overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-label="Top movers tape"
      >
        {movers.length === 0 ? (
          <p className="text-cyan-400 text-sm font-mono py-6 text-center">No movers on the board yet</p>
        ) : (
          movers.map((m) => {
            // Upstream (polygon.ts) defaults price + change to 0 when both day-close and
            // prev-close are missing. A real $0.00 / +0.00% flat quote can't exist, so treat
            // a non-positive price as "no quote" and show an em-dash instead of a fabricated
            // value that reads as a real flat tape print. Don't change polygon.ts — display only.
            const hasQuote = Number.isFinite(m.price) && m.price > 0;
            return (
              <div key={m.ticker} className="desk-mover-row">
                <span className="font-anton text-2xl text-white w-16">{m.ticker}</span>
                <span className="font-mono text-xs text-sky-300 flex-1">{hasQuote ? `$${m.price.toFixed(2)}` : "—"}</span>
                {hasQuote ? (
                  <span className={clsx("font-mono text-sm font-bold tabular-nums", m.change_pct >= 0 ? "num-bull" : "num-bear")}>
                    {fmtPct(m.change_pct)}
                  </span>
                ) : (
                  <span className="font-mono text-sm font-bold tabular-nums text-sky-300">—</span>
                )}
              </div>
            );
          })
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
      <p className="text-[10px] font-mono uppercase tracking-wider text-sky-200 truncate">{name}</p>
      <p className={clsx("font-mono text-sm font-bold mt-1 tabular-nums", bull ? "text-bull" : "text-bear")}>
        {fmtPct(change)}
      </p>
    </div>
  );
}
