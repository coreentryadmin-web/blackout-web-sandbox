"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import { useGridBootstrapGate } from "@/hooks/useGridBootstrapGate";
import type { GridSectorRow, GridSectorsSnapshot } from "@/lib/providers/grid";

type Res = { available: boolean } & Partial<GridSectorsSnapshot>;

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<Res>;

function heatColor(pct: number): string {
  if (pct >= 2) return "bg-emerald-500/25 text-emerald-300 border-emerald-500/30";
  if (pct >= 0.5) return "bg-emerald-500/15 text-emerald-400/80 border-emerald-500/20";
  if (pct >= 0) return "bg-emerald-500/8 text-emerald-400/60 border-emerald-500/10";
  if (pct >= -0.5) return "bg-[#ff5c78]/8 text-[#ff5c78]/60 border-[#ff5c78]/10";
  if (pct >= -2) return "bg-[#ff5c78]/15 text-[#ff5c78]/80 border-[#ff5c78]/20";
  return "bg-[#ff5c78]/25 text-[#ff5c78] border-[#ff5c78]/30";
}

function SectorCell({ sector }: { sector: GridSectorRow }) {
  const pct = sector.change_pct;
  return (
    <div className={clsx("grid-sector-cell border", heatColor(pct))}>
      <span className="grid-sector-name">{sector.name.replace("Cons. ", "")}</span>
      <span className="grid-sector-pct">
        {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
      </span>
    </div>
  );
}

export function GridSectorsPanel() {
  const { isFiltered } = useGridTicker();
  const { panelKey, revalidateOnMount } = useGridBootstrapGate();
  const { data, error } = useSWR<Res>(panelKey("/api/grid/sectors"), fetcher, {
    refreshInterval: 90_000,
    revalidateOnMount,
  });
  const sectors: GridSectorRow[] = data?.sectors ?? [];
  const live = !error && (data?.available ?? false);

  return (
    <GridCard
      title="Sector Heat"
      kicker="SECTORS"
      accent="gold"
      live={live}
      span={2}
      footer={<span className="grid-foot-note">Live sectors · 11 SPDR sector ETFs · intraday % change</span>}
    >
      {isFiltered && (
        <p className="grid-empty text-sky-400/60 text-[10px]">Market-wide · ticker filter not applicable</p>
      )}
      {sectors.length === 0 ? (
        <p className="grid-empty">
          {data ? "No sector data" : error ? "Sector feed offline" : "Loading sectors…"}
        </p>
      ) : (
        <div className="grid-sector-tiles">
          {sectors.map((s) => (
            <SectorCell key={s.ticker} sector={s} />
          ))}
        </div>
      )}
    </GridCard>
  );
}
