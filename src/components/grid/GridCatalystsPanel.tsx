"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import type { GridCatalystItem, GridCatalystsSnapshot } from "@/lib/providers/grid";

type Res = { available: boolean; ticker?: string } & Partial<GridCatalystsSnapshot>;

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<Res>;

const TYPE_ACCENT: Record<GridCatalystItem["type"], string> = {
  binary:   "pulse-tone-bear",
  guidance: "pulse-tone-gold",
  "m&a":    "pulse-tone-emerald",
  insider:  "pulse-tone-sky",
  buyback:  "pulse-tone-emerald",
  offering: "pulse-tone-gold",
  short:    "pulse-tone-bear",
  ipo:      "pulse-tone-sky",
  other:    "text-sky-300/70",
};

const TYPE_LABEL: Record<GridCatalystItem["type"], string> = {
  binary:   "FDA",
  guidance: "GUIDANCE",
  "m&a":    "M&A",
  insider:  "INSIDER",
  buyback:  "BUYBACK",
  offering: "OFFERING",
  short:    "SHORT",
  ipo:      "IPO",
  other:    "OTHER",
};

function fmtRelative(published: string): string {
  if (!published) return "";
  const ms = Date.now() - new Date(published).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function CatalystRow({ item }: { item: GridCatalystItem }) {
  return (
    <li className="flex items-start gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span className={clsx("grid-tag shrink-0 text-[9px] mt-0.5", TYPE_ACCENT[item.type])}>
        {TYPE_LABEL[item.type]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 font-mono text-[11px] leading-snug text-cyan-400">
          {item.title}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[9px] tabular-nums text-sky-300/50">
        {fmtRelative(item.published)}
      </span>
    </li>
  );
}

/**
 * Panel 11 — Corporate Catalysts. Market-wide events (FDA decisions, M&A, guidance,
 * insider activity, buybacks, offerings, IPOs) from the Benzinga catalyst channels.
 * Compact list — ticker, type, time, one-line description. Refreshes every 5 min.
 */
export function GridCatalystsPanel() {
  const { ticker, isFiltered } = useGridTicker();
  const url = `/api/grid/catalysts${ticker ? `?ticker=${ticker}` : ""}`;
  const { data, error } = useSWR<Res>(url, fetcher, { refreshInterval: isFiltered ? 30_000 : 300_000 });
  const items: GridCatalystItem[] = data?.items ?? [];
  const live = !error && (data?.available ?? false) && items.length > 0;

  return (
    <GridCard
      title="Corporate Catalysts"
      kicker="CATALYSTS"
      accent="gold"
      live={live}
      span={2}
      footer={<span className="grid-foot-note">FDA · M&amp;A · Guidance · Insider · Buybacks · Offerings</span>}
    >
      {isFiltered && ticker && (
        <p className="grid-ticker-badge">Showing {ticker} catalysts</p>
      )}
      {items.length === 0 ? (
        <p className="grid-empty">
          {data
            ? isFiltered && ticker
              ? `No catalysts found for ${ticker}`
              : "No catalysts"
            : error
            ? "Catalyst feed offline"
            : "Loading catalysts…"}
        </p>
      ) : (
        <ul className="grid-earn-list">
          {items.slice(0, 16).map((item, i) => (
            <CatalystRow key={`${item.published}-${i}`} item={item} />
          ))}
        </ul>
      )}
    </GridCard>
  );
}
