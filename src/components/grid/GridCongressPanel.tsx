"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import type { GridCongresstrade, GridCongressSnapshot } from "@/lib/providers/grid";

type Res = { available: boolean; ticker?: string } & Partial<GridCongressSnapshot>;

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<Res>;

function tradeColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("purchase") || t.includes("buy")) return "pulse-tone-emerald";
  if (t.includes("sale") || t.includes("sell")) return "pulse-tone-bear";
  return "pulse-tone-sky";
}

function partyDot(party: string): string {
  const p = party.toUpperCase();
  if (p.startsWith("R")) return "text-[#ff5c78]";
  if (p.startsWith("D")) return "text-sky-400";
  return "text-sky-300/50";
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

export function GridCongressPanel() {
  const { ticker, isFiltered } = useGridTicker();
  const url = `/api/grid/congress${ticker ? `?ticker=${ticker}` : ""}`;
  const { data, error } = useSWR<Res>(url, fetcher, { refreshInterval: isFiltered ? 30_000 : 300_000 });
  const trades: GridCongresstrade[] = data?.trades ?? [];
  const live = !error && (data?.available ?? false) && trades.length > 0;

  return (
    <GridCard
      title="Congress Trades"
      kicker="CONGRESS"
      accent="bear"
      live={live}
      footer={<span className="grid-foot-note">Unusual Whales · congressional stock disclosures</span>}
    >
      {isFiltered && ticker && (
        <p className="grid-ticker-badge">Showing {ticker} congress trades</p>
      )}
      {trades.length === 0 ? (
        <p className="grid-empty">
          {data
            ? isFiltered && ticker
              ? `No congress trades for ${ticker}`
              : "No recent congress trades"
            : error
            ? "Congress feed offline"
            : "Loading trades…"}
        </p>
      ) : (
        <ul className="grid-congress-list">
          {trades.slice(0, 18).map((t, i) => (
            <li key={i} className="grid-congress-row">
              <span className={clsx("grid-congress-dot", partyDot(t.party))}>●</span>
              <span className="grid-congress-name">{shortName(t.politician)}</span>
              <span className="grid-congress-ticker">{t.ticker}</span>
              <span className={clsx("grid-tag text-[9px]", tradeColor(t.type))}>
                {t.type.length > 8 ? t.type.slice(0, 8) : t.type || "?"}
              </span>
              {t.amount && <span className="grid-congress-amt">{t.amount}</span>}
            </li>
          ))}
        </ul>
      )}
    </GridCard>
  );
}
