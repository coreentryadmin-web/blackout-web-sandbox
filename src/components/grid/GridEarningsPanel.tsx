"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import type { GridEarningsItem, GridEarningsSnapshot, GridEarningsHistoryItem } from "@/lib/providers/grid";

type MarketRes = { available: boolean; mode?: never; ticker?: string } & Partial<GridEarningsSnapshot>;
type TickerRes = {
  available: boolean;
  mode: "ticker";
  ticker: string;
  history: GridEarningsHistoryItem[];
  next_date: string | null;
  next_when: "premarket" | "afterhours" | null;
  as_of: string;
};
type Res = MarketRes | TickerRes;

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<Res>;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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

function TickerEarningsView({ data }: { data: TickerRes }) {
  const history = data.history ?? [];
  const nextDate = data.next_date;
  const nextWhen = data.next_when;

  return (
    <div className="flex flex-col gap-3">
      {/* Next earnings */}
      {nextDate ? (
        <div className="rounded border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
          <p className="text-[10px] text-sky-400/60 uppercase tracking-wider mb-1">Next Earnings</p>
          <p className="text-sm text-white font-medium">
            {formatDate(nextDate)}{nextWhen ? ` · ${nextWhen === "premarket" ? "Pre-Market" : "After Hours"}` : ""}
          </p>
        </div>
      ) : (
        <div className="rounded border border-white/5 px-3 py-2">
          <p className="text-[10px] text-sky-400/60 uppercase tracking-wider mb-1">Next Earnings</p>
          <p className="text-xs text-white/40">Date unconfirmed</p>
        </div>
      )}

      {/* Previous earnings history */}
      <div>
        <p className="text-[10px] text-sky-400/60 uppercase tracking-wider mb-2">Previous Earnings</p>
        {history.length === 0 ? (
          <p className="text-xs text-white/40">No historical data available</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-sky-400/50 border-b border-white/5">
                <th className="text-left pb-1">Quarter</th>
                <th className="text-right pb-1">EPS Act</th>
                <th className="text-right pb-1">EPS Est</th>
                <th className="text-right pb-1">Surprise</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 6).map((item, i) => (
                <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="py-1.5 text-white/70">
                    {item.quarter}
                    <span className="text-white/30 ml-1 text-[9px]">{item.date}</span>
                  </td>
                  <td className="text-right text-white">{item.eps_actual != null ? item.eps_actual.toFixed(2) : "—"}</td>
                  <td className="text-right text-white/60">{item.eps_estimate != null ? item.eps_estimate.toFixed(2) : "—"}</td>
                  <td className="text-right">
                    {item.surprise_pct != null ? (
                      <span className={item.surprise_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {item.surprise_pct >= 0 ? "+" : ""}{item.surprise_pct.toFixed(1)}%
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function GridEarningsPanel() {
  const { ticker, isFiltered } = useGridTicker();
  const url = `/api/grid/earnings${ticker ? `?ticker=${ticker}` : ""}`;
  const { data, error } = useSWR<Res>(url, fetcher, { refreshInterval: isFiltered ? 30_000 : 300_000 });
  const live = !error && (data?.available ?? false);

  const isTickerMode = data && "mode" in data && data.mode === "ticker";

  return (
    <GridCard
      title={isTickerMode ? `${(data as TickerRes).ticker} Earnings` : "Earnings Radar"}
      kicker="EARNINGS"
      accent="sky"
      live={live}
      span={2}
      footer={<span className="grid-foot-note">Live feed · {isTickerMode ? "per-ticker history + next date" : "pre-market + after-hours reporters"}</span>}
    >
      {isTickerMode ? (
        <TickerEarningsView data={data as TickerRes} />
      ) : (
        <>
          {isFiltered && ticker && (
            <p className="grid-ticker-badge">Showing {ticker} earnings</p>
          )}
          {(() => {
            const items: GridEarningsItem[] = (data as MarketRes)?.items ?? [];
            if (items.length === 0) {
              return (
                <p className="grid-empty">
                  {data
                    ? isFiltered && ticker
                      ? `No earnings found for ${ticker}`
                      : "No earnings today"
                    : error
                    ? "Earnings feed offline"
                    : "Loading earnings…"}
                </p>
              );
            }
            return (
              <ul className="grid-earn-list">
                {items.slice(0, 24).map((item, i) => (
                  <EarningsRow key={`${item.ticker}-${i}`} item={item} />
                ))}
              </ul>
            );
          })()}
        </>
      )}
    </GridCard>
  );
}
