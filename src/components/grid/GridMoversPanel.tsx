"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridBootstrapGate } from "@/hooks/useGridBootstrapGate";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import type { GridMover, GridMoversSnapshot } from "@/lib/providers/grid";

type Res = { available: boolean } & Partial<GridMoversSnapshot>;

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<Res>;

function MoverRow({ m, side }: { m: GridMover; side: "up" | "down" }) {
  return (
    <li className="grid-mover-row">
      <span className="grid-mover-ticker">{m.ticker}</span>
      {m.price > 0 && <span className="grid-mover-price text-sky-300/60">${m.price.toFixed(2)}</span>}
      <span className={clsx("grid-mover-pct ml-auto font-mono", side === "up" ? "text-emerald-400" : "text-[#ff5c78]")}>
        {m.change_pct >= 0 ? "+" : ""}{m.change_pct.toFixed(2)}%
      </span>
    </li>
  );
}

export function GridMoversPanel() {
  const { isFiltered } = useGridTicker();
  const { panelKey, revalidateOnMount } = useGridBootstrapGate();
  const { data, error } = useSWR<Res>(panelKey("/api/grid/movers"), fetcher, {
    refreshInterval: 90_000,
    revalidateOnMount,
  });
  const gainers: GridMover[] = data?.gainers ?? [];
  const losers: GridMover[] = data?.losers ?? [];
  const live = !error && (data?.available ?? false);

  return (
    <GridCard
      title="Top Movers"
      kicker="MOVERS"
      accent="gold"
      live={live}
      footer={<span className="grid-foot-note">Live movers · intraday gainers + losers</span>}
    >
      {isFiltered && (
        <p className="grid-empty text-sky-400/60 text-[10px]">Market-wide · ticker filter not applicable</p>
      )}
      {gainers.length === 0 && losers.length === 0 ? (
        <p className="grid-empty">
          {data ? "No movers" : error ? "Movers offline" : "Loading movers…"}
        </p>
      ) : (
        <div className="grid-movers-cols">
          <div>
            <p className="grid-movers-header text-emerald-400">GAINERS</p>
            <ul className="grid-mover-list">
              {gainers.slice(0, 8).map((m) => <MoverRow key={m.ticker} m={m} side="up" />)}
            </ul>
          </div>
          <div>
            <p className="grid-movers-header text-[#ff5c78]">LOSERS</p>
            <ul className="grid-mover-list">
              {losers.slice(0, 8).map((m) => <MoverRow key={m.ticker} m={m} side="down" />)}
            </ul>
          </div>
        </div>
      )}
    </GridCard>
  );
}
