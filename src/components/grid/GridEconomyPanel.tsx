"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import type { GridEconomySnapshot } from "@/lib/providers/grid";
import type { UwMacroIndicatorSnapshot } from "@/lib/providers/unusual-whales";

type Res = { available: boolean } & Partial<GridEconomySnapshot>;

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<Res>;

function fmtValue(ind: UwMacroIndicatorSnapshot): string {
  const v = ind.latest_value;
  if (v == null) return "—";
  const id = ind.indicator.toUpperCase();
  if (id === "FED-FUNDS" || id === "FED_FUNDS" || id.includes("YIELD") || id.includes("RATE"))
    return `${v.toFixed(2)}%`;
  if (id === "CPI" || id === "INFLATION" || id === "UNEMPLOYMENT" || id.includes("PAYROLLS"))
    return v < 100 ? `${v.toFixed(1)}%` : v.toLocaleString();
  // UW latest_value for GDP is the nominal level in billions — show as $xT
  if (id === "GDP" || id.includes("GDP")) return v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `${v.toFixed(1)}B`;
  return v.toLocaleString();
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const pos = pct > 0;
  return (
    <span className={clsx("grid-econ-chg text-[10px]", pos ? "text-emerald-400" : "text-[#ff5c78]")}>
      {pos ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

export function GridEconomyPanel() {
  const { isFiltered } = useGridTicker();
  const { data, error } = useSWR<Res>("/api/grid/economy", fetcher, { refreshInterval: 3_600_000 });
  const indicators: UwMacroIndicatorSnapshot[] = data?.indicators ?? [];
  const live = !error && (data?.available ?? false);

  return (
    <GridCard
      title="Economic Calendar"
      kicker="MACRO"
      accent="emerald"
      live={live}
      span={2}
      footer={<span className="grid-foot-note">Macro calendar · CPI · Fed Funds · GDP · Payrolls · Unemployment</span>}
    >
      {isFiltered && (
        <p className="grid-empty text-sky-400/60 text-[10px]">Market-wide · ticker filter not applicable</p>
      )}
      {indicators.length === 0 ? (
        <p className="grid-empty">
          {data ? "No macro data" : error ? "Macro feed offline" : "Loading macro…"}
        </p>
      ) : (
        <div className="grid-econ-tiles">
          {indicators.map((ind) => (
            <div key={ind.indicator} className="grid-econ-tile">
              <span className="grid-econ-label">{ind.label}</span>
              <span className="grid-econ-value">{fmtValue(ind)}</span>
              <div className="grid-econ-sub">
                {ind.prior_value != null && (
                  <span className="text-sky-300/60 text-[10px]">prior {ind.prior_value.toFixed(1)}</span>
                )}
                <ChangeBadge pct={ind.change_pct} />
              </div>
            </div>
          ))}
        </div>
      )}
    </GridCard>
  );
}
