"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";

type SectorRow = {
  name: string;
  ticker?: string;
  change_pct: number;
};

type HeatmapResponse = {
  source?: string;
  sectors?: SectorRow[];
  movers?: unknown[];
  as_of?: string;
  error?: string;
};

const fetcher = () =>
  fetch("/api/market/heatmap", { cache: "no-store", credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<HeatmapResponse>) : null))
    .catch(() => null);

function heatColor(pct: number): string {
  if (pct >= 2) return "bg-emerald-500/25 text-emerald-300 border-emerald-500/30";
  if (pct >= 0.5) return "bg-emerald-500/15 text-emerald-400/80 border-emerald-500/20";
  if (pct >= 0) return "bg-emerald-500/8 text-emerald-400/60 border-emerald-500/10";
  if (pct >= -0.5) return "bg-[#ff5c78]/8 text-[#ff5c78]/60 border-[#ff5c78]/10";
  if (pct >= -2) return "bg-[#ff5c78]/15 text-[#ff5c78]/80 border-[#ff5c78]/20";
  return "bg-[#ff5c78]/25 text-[#ff5c78] border-[#ff5c78]/30";
}

function SectorTile({ sector }: { sector: SectorRow }) {
  const pct = sector.change_pct;
  return (
    <div className={clsx("grid-sector-cell border", heatColor(pct))}>
      <span className="grid-sector-name">{sector.name.replace("Cons. ", "").replace(" Select Sector SPDR", "")}</span>
      <span className="grid-sector-pct">
        {pct >= 0 ? "+" : ""}
        {pct.toFixed(2)}%
      </span>
    </div>
  );
}

/**
 * GridSectorHeatmapPanel — sector performance heatmap from /api/market/heatmap.
 * Uses the Polygon sector ETF performance feed (11 SPDR sectors). Gated to the
 * "heatmap" tool so it degrades gracefully when the user doesn't have access.
 */
export function GridSectorHeatmapPanel() {
  const { isFiltered, ticker } = useGridTicker();
  const { data, error } = useSWR<HeatmapResponse | null>(
    "grid-sector-heatmap",
    fetcher,
    { refreshInterval: 90_000 }
  );

  const sectors: SectorRow[] = data?.sectors ?? [];
  const live = !error && !!data && !data.error && sectors.length > 0;

  return (
    <GridCard
      title="Sector Heatmap"
      kicker="SECTORS"
      accent="gold"
      live={live && !isFiltered}
      span={2}
      footer={
        <span className="grid-foot-note">
          Live sectors · 11 SPDR sectors · intraday % change
        </span>
      }
    >
      {isFiltered && ticker ? (
        <p className="grid-empty text-sky-400/60">
          Sector heatmap is market-wide — not available in {ticker} mode. Clear the filter to see all sectors.
        </p>
      ) : !data && !error ? (
        <p className="grid-empty">Loading sector data…</p>
      ) : error || !live ? (
        <p className="grid-empty">Sector feed unavailable</p>
      ) : (
        <div className="grid-sector-tiles">
          {sectors.map((s, i) => (
            <SectorTile key={s.ticker ?? s.name ?? i} sector={s} />
          ))}
        </div>
      )}
    </GridCard>
  );
}
