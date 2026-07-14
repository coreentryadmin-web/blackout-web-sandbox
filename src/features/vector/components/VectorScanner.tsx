"use client";

import { useState } from "react";
import useSWR from "swr";
import type { VectorUniverseSnapshot, VectorUniverseRow } from "@/features/vector";
import { fmtPrice } from "@/lib/api";
import {
  screenUniverse,
  screenerRegimeOf,
  type ScreenerPreset,
} from "@/features/vector/lib/vector-screener";

async function fetchUniverse(): Promise<VectorUniverseSnapshot> {
  const res = await fetch("/api/market/vector/universe", { cache: "no-store" });
  if (!res.ok) throw new Error("universe fetch failed");
  return res.json();
}

type Props = {
  activeTicker: string;
  onSelect: (ticker: string) => void;
};

/** Signed distance from spot to a level, in %, for the proximity read. */
function distPct(spot: number | null, level: number | null): number | null {
  if (spot == null || level == null || spot <= 0) return null;
  return ((level - spot) / spot) * 100;
}

function fmtDist(pct: number | null): string {
  if (pct == null) return "—";
  const s = pct >= 0 ? "+" : "";
  return `${s}${pct.toFixed(1)}%`;
}

const PRESETS: Array<{ key: ScreenerPreset; label: string; hint: string }> = [
  { key: "all", label: "All", hint: "Every covered name, A–Z" },
  { key: "nearest-flip", label: "Nearest flip", hint: "Closest to a regime change — most actionable" },
  { key: "most-pinned", label: "Most pinned", hint: "Above flip with the strongest walls — mean-revert" },
  { key: "most-explosive", label: "Most explosive", hint: "Below flip and near it — vol-expansion risk" },
];

export function VectorScanner({ activeTicker, onSelect }: Props) {
  const { data, error, isLoading } = useSWR("vector-universe", fetchUniverse, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  });
  const [preset, setPreset] = useState<ScreenerPreset>("all");

  if (isLoading && !data) {
    return (
      <p className="vector-scanner-note" role="status">
        Loading universe…
      </p>
    );
  }

  if (error || !data?.rows?.length) {
    return (
      <p className="vector-scanner-note" role="status">
        Universe snapshot unavailable — pick a symbol above.
      </p>
    );
  }

  const activePreset = PRESETS.find((p) => p.key === preset) ?? PRESETS[0]!;
  const displayRows = screenUniverse(data.rows, { preset });

  return (
    <div className="vector-scanner-table-wrap">
      <div className="vector-screener-controls" role="group" aria-label="Screener view">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`vector-screener-chip${p.key === preset ? " is-active" : ""}`}
            aria-pressed={p.key === preset}
            title={p.hint}
            onClick={() => setPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
        <span className="vector-screener-hint">{activePreset.hint}</span>
      </div>
      {displayRows.length === 0 && (
        <p className="vector-scanner-note" role="status">
          No names match “{activePreset.label}” right now.
        </p>
      )}
      <table className="vector-scanner-table">
        <thead>
          <tr>
            <th scope="col">Ticker</th>
            <th scope="col" className="vs-num">Spot</th>
            <th scope="col" className="vs-num">Regime</th>
            <th scope="col" className="vs-num">Gamma flip</th>
            <th scope="col" className="vs-num">Call wall</th>
            <th scope="col" className="vs-num">Put wall</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row) => {
            const selected = row.ticker === activeTicker;
            const regime = screenerRegimeOf(row);
            const flipDist = distPct(row.spot, row.gammaFlip);
            const callDist = distPct(row.spot, row.topCallWall);
            const putDist = distPct(row.spot, row.topPutWall);
            return (
              <tr
                key={row.ticker}
                className={`vector-scanner-row vs-regime-${regime}${selected ? " is-active" : ""}`}
                onClick={() => onSelect(row.ticker)}
                aria-current={selected ? "true" : undefined}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(row.ticker);
                  }
                }}
              >
                <td className="vs-ticker">
                  <span className="vs-regime-dot" aria-hidden="true" />
                  {row.ticker}
                </td>
                <td className="vs-num">{fmtPrice(row.spot)}</td>
                <td className="vs-num">
                  <span className={`vs-regime-tag vs-regime-tag-${regime}`}>
                    {regime === "above" ? "▲ above" : regime === "below" ? "▼ below" : "—"}
                  </span>
                </td>
                <td className="vs-num">
                  {fmtPrice(row.gammaFlip)}
                  <span className="vs-dist">{fmtDist(flipDist)}</span>
                </td>
                <td className="vs-num vs-call">
                  {fmtPrice(row.topCallWall)}
                  <span className="vs-dist">{fmtDist(callDist)}</span>
                </td>
                <td className="vs-num vs-put">
                  {fmtPrice(row.topPutWall)}
                  <span className="vs-dist">{fmtDist(putDist)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
