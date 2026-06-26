"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import type { GridEarningsItem, GridEarningsSnapshot } from "@/lib/providers/grid";

type Res = { available: boolean } & Partial<GridEarningsSnapshot>;

const fetcher = () =>
  fetch("/api/grid/earnings", { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<Res>;

function SurpriseTag({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const pos = pct > 0;
  return (
    <span className={clsx("grid-tag text-[10px]", pos ? "pulse-tone-emerald" : "pulse-tone-bear")}>
      {pos ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

function EarningsRow({ item }: { item: GridEarningsItem }) {
  const whenLabel = item.when === "premarket" ? "PRE" : "AH";
  return (
    <li className="grid-earn-row">
      <span className={clsx("grid-tag text-[9px]", item.when === "premarket" ? "pulse-tone-sky" : "pulse-tone-gold")}>
        {whenLabel}
      </span>
      <span className="grid-earn-ticker">{item.ticker}</span>
      {item.eps_estimate != null && (
        <span className="grid-earn-est text-sky-300/70">
          est {item.eps_estimate >= 0 ? "" : ""}{item.eps_estimate.toFixed(2)}
        </span>
      )}
      {item.eps_actual != null && (
        <span className="grid-earn-act">act {item.eps_actual.toFixed(2)}</span>
      )}
      <SurpriseTag pct={item.surprise_pct} />
    </li>
  );
}

export function GridEarningsPanel() {
  const { data, error } = useSWR<Res>("grid-earnings", fetcher, { refreshInterval: 300_000 });
  const items: GridEarningsItem[] = data?.items ?? [];
  const live = !error && (data?.available ?? false) && items.length > 0;

  return (
    <GridCard
      title="Earnings Radar"
      kicker="EARNINGS"
      accent="sky"
      live={live}
      span={2}
      footer={<span className="grid-foot-note">Unusual Whales · pre-market + after-hours reporters</span>}
    >
      {items.length === 0 ? (
        <p className="grid-empty">
          {data ? "No earnings today" : error ? "Earnings feed offline" : "Loading earnings…"}
        </p>
      ) : (
        <ul className="grid-earn-list">
          {items.slice(0, 24).map((item, i) => (
            <EarningsRow key={`${item.ticker}-${i}`} item={item} />
          ))}
        </ul>
      )}
    </GridCard>
  );
}
