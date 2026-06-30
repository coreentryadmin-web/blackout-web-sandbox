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

/** Clean transaction label — no more truncating "Purchase" -> "Purchas". */
function tradeLabel(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("purchase") || t.includes("buy")) return "BUY";
  if (t.includes("sale") || t.includes("sell")) {
    if (t.includes("partial")) return "SELL·P";
    if (t.includes("full")) return "SELL·F";
    return "SELL";
  }
  if (t.includes("exchange")) return "EXCH";
  if (t.includes("receive")) return "RECV";
  return type ? type.toUpperCase() : "?";
}

/** "2026-06-29" -> "Jun 29". */
function fmtFiled(d: string): string {
  if (!d) return "";
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function GridCongressPanel() {
  const { ticker, isFiltered } = useGridTicker();
  const url = `/api/grid/congress${ticker ? `?ticker=${ticker}` : ""}`;
  const { data, error } = useSWR<Res>(url, fetcher, { refreshInterval: isFiltered ? 30_000 : 300_000 });
  const trades: GridCongresstrade[] = data?.trades ?? [];
  const live = !error && (data?.available ?? false);

  return (
    <GridCard
      title="Congress Trades"
      kicker="CONGRESS"
      accent="bear"
      live={live}
      footer={<span className="grid-foot-note">Disclosures feed · congressional stock disclosures</span>}
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
            <li key={`${t.politician}${t.ticker}${t.filed_at ?? i}`} className="grid-congress-row">
              <span className={clsx("grid-congress-dot", partyDot(t.party))}>●</span>
              <span className="grid-congress-name">{shortName(t.politician)}</span>
              <span className="grid-congress-ticker">{t.ticker}</span>
              <span className={clsx("grid-tag text-[9px]", tradeColor(t.type))}>
                {tradeLabel(t.type)}
              </span>
              {t.amount && <span className="grid-congress-amt">{t.amount}</span>}
              {t.filed_at && <span className="grid-congress-date">{fmtFiled(t.filed_at)}</span>}
            </li>
          ))}
        </ul>
      )}
    </GridCard>
  );
}
