"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import type { GridMover, GridMoversSnapshot } from "@/lib/providers/grid";

type Res = { available: boolean } & Partial<GridMoversSnapshot>;

const fetcher = () =>
  fetch("/api/grid/movers", { cache: "no-store", credentials: "same-origin" })
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
  const { data, error } = useSWR<Res>("grid-movers", fetcher, { refreshInterval: 90_000 });
  const gainers: GridMover[] = data?.gainers ?? [];
  const losers: GridMover[] = data?.losers ?? [];
  const live = !error && (data?.available ?? false) && (gainers.length > 0 || losers.length > 0);

  return (
    <GridCard
      title="Top Movers"
      kicker="MOVERS"
      accent="gold"
      live={live}
      footer={<span className="grid-foot-note">Polygon · intraday gainers + losers</span>}
    >
      {gainers.length === 0 && losers.length === 0 ? (
        <p className="grid-empty">
          {data ? "No movers" : error ? "Movers offline" : "Loading movers…"}
        </p>
      ) : (
        <div className="grid-movers-cols">
          <div>
            <p className="grid-movers-header text-emerald-400">GAINERS</p>
            <ul className="grid-mover-list">
              {gainers.slice(0, 8).map((m, i) => <MoverRow key={i} m={m} side="up" />)}
            </ul>
          </div>
          <div>
            <p className="grid-movers-header text-[#ff5c78]">LOSERS</p>
            <ul className="grid-mover-list">
              {losers.slice(0, 8).map((m, i) => <MoverRow key={i} m={m} side="down" />)}
            </ul>
          </div>
        </div>
      )}
    </GridCard>
  );
}
