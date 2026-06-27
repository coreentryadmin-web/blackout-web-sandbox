"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import type { GridDarkPoolPrint, GridDarkPoolSnapshot } from "@/lib/providers/grid";

type Res = { available: boolean; ticker?: string } & Partial<GridDarkPoolSnapshot>;

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<Res>;

function fmtPremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function SideTag({ side }: { side: string }) {
  const s = side.toLowerCase();
  const isBull = s.includes("buy") || s.includes("bull") || s === "b";
  const isBear = s.includes("sell") || s.includes("bear") || s === "s";
  return (
    <span
      className={clsx(
        "grid-tag",
        isBull ? "pulse-tone-emerald" : isBear ? "pulse-tone-bear" : "pulse-tone-sky"
      )}
    >
      {isBull ? "BUY" : isBear ? "SELL" : side.toUpperCase() || "?"}
    </span>
  );
}

export function GridDarkPoolPanel() {
  const { ticker, isFiltered } = useGridTicker();
  const url = `/api/grid/dark-pool${ticker ? `?ticker=${ticker}` : ""}`;
  const { data, error } = useSWR<Res>(url, fetcher, { refreshInterval: isFiltered ? 30_000 : 90_000 });
  const prints: GridDarkPoolPrint[] = data?.prints ?? [];
  const live = !error && (data?.available ?? false) && prints.length > 0;

  return (
    <GridCard
      title="Dark Pool Prints"
      kicker="DARK POOL"
      accent="violet"
      live={live}
      footer={<span className="grid-foot-note">Unusual Whales · market-wide off-lit prints</span>}
    >
      {isFiltered && ticker && (
        <p className="grid-ticker-badge">Showing {ticker} dark pool prints</p>
      )}
      {prints.length === 0 ? (
        <p className="grid-empty">
          {data
            ? isFiltered && ticker
              ? `No dark pool prints for ${ticker}`
              : "No dark pool prints"
            : error
            ? "Dark pool offline"
            : "Loading prints…"}
        </p>
      ) : (
        <ul className="grid-dp-list">
          {prints.slice(0, 18).map((p, i) => (
            <li key={i} className="grid-dp-row">
              <span className="grid-dp-ticker">{p.ticker}</span>
              <SideTag side={p.side} />
              <span className="grid-dp-premium">{fmtPremium(p.premium)}</span>
            </li>
          ))}
        </ul>
      )}
    </GridCard>
  );
}
