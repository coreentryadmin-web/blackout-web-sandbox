"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { GridCard } from "./GridCard";
import { useGridBootstrapGate } from "@/hooks/useGridBootstrapGate";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";
import type { GridEconomySnapshot } from "@/lib/providers/grid";
import type { UwMacroIndicatorSnapshot } from "@/lib/providers/unusual-whales";

type Res = { available: boolean } & Partial<GridEconomySnapshot>;

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then((r) => r.json()) as Promise<Res>;

const LABEL_MAP: Record<string, string> = {
  "retail-sales": "Retail Sales",
  "retail_sales": "Retail Sales",
  "fed-funds": "Fed Funds Rate",
  "fed_funds": "Fed Funds Rate",
  "treasury-yield": "Treasury Yield",
  "treasury_yield": "Treasury Yield",
  "payrolls": "Payrolls",
  "unemployment": "Unemployment",
  "inflation": "Inflation",
  "cpi": "CPI",
  "gdp": "GDP",
};

function humanLabel(ind: UwMacroIndicatorSnapshot): string {
  const key = (ind.label ?? ind.indicator).toLowerCase();
  return LABEL_MAP[key] ?? ind.label ?? ind.indicator;
}

function fmtIndicatorValue(ind: UwMacroIndicatorSnapshot, v: number | null | undefined): string {
  if (v == null) return "—";
  const id = ind.indicator.toUpperCase().replace(/-/g, "_");
  if (id === "FED_FUNDS" || id.includes("YIELD") || id.includes("RATE"))
    return `${v.toFixed(2)}%`;
  if (id === "CPI" || id === "INFLATION" || id === "UNEMPLOYMENT")
    return v < 100 ? `${v.toFixed(1)}%` : v.toLocaleString();
  // RETAIL-SALES: UW returns value in millions (e.g. 684300 = $684.3B)
  if (id === "RETAIL_SALES" || id === "RETAIL-SALES")
    return `$${(v / 1000).toFixed(1)}B`;
  // PAYROLLS: UW returns thousands of jobs (e.g. 159467 ≈ 159.5M jobs)
  if (id.includes("PAYROLL"))
    return `${(v / 1000).toFixed(1)}M jobs`;
  // GDP: nominal level in billions
  if (id === "GDP" || id.includes("GDP")) return v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `$${v.toFixed(1)}B`;
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
  const { panelKey, revalidateOnMount } = useGridBootstrapGate();
  const { data, error } = useSWR<Res>(panelKey("/api/grid/economy"), fetcher, {
    refreshInterval: 3_600_000,
    revalidateOnMount,
  });
  const indicators: UwMacroIndicatorSnapshot[] = data?.indicators ?? [];
  const live = !error && (data?.available ?? false);

  return (
    <GridCard
      title="Macro Indicators"
      kicker="MACRO"
      accent="emerald"
      live={live}
      span={2}
      footer={<span className="grid-foot-note">Latest readings · CPI · Fed Funds · GDP · Payrolls · Unemployment · Treasury · Retail</span>}
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
              <span className="grid-econ-label">{humanLabel(ind)}</span>
              <span className="grid-econ-value">{fmtIndicatorValue(ind, ind.latest_value)}</span>
              <div className="grid-econ-sub">
                {ind.prior_value != null && (
                  <span className="text-sky-300/60 text-[10px]">prior {fmtIndicatorValue(ind, ind.prior_value)}</span>
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
