"use client";

import useSWR from "swr";
import type { VectorUniverseSnapshot } from "@/features/vector";
import { fmtPrice } from "@/lib/api";

async function fetchUniverse(): Promise<VectorUniverseSnapshot> {
  const res = await fetch("/api/market/vector/universe", { cache: "no-store" });
  if (!res.ok) throw new Error("universe fetch failed");
  return res.json();
}

type Props = {
  activeTicker: string;
  onSelect: (ticker: string) => void;
};

/** Market-wide Vector scanner — summary rows only, no per-ticker SSE. */
export function VectorScanner({ activeTicker, onSelect }: Props) {
  const { data, error, isLoading } = useSWR("vector-universe", fetchUniverse, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  if (isLoading && !data) {
    return (
      <p className="text-sm text-cyan-300" role="status">
        Loading universe…
      </p>
    );
  }

  if (error || !data?.rows?.length) {
    return (
      <p className="text-sm text-cyan-300" role="status">
        Universe snapshot unavailable — pick a symbol above.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-cyan-500/20">
      <table className="min-w-full text-left text-xs text-white">
        <thead className="bg-black/50 text-cyan-300">
          <tr>
            <th className="px-3 py-2">Ticker</th>
            <th className="px-3 py-2">Spot</th>
            <th className="px-3 py-2">Gamma flip</th>
            <th className="px-3 py-2">Call wall</th>
            <th className="px-3 py-2">Put wall</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => {
            const selected = row.ticker === activeTicker;
            return (
              <tr
                key={row.ticker}
                className={selected ? "bg-cyan-500/15" : "hover:bg-white/5 cursor-pointer"}
                onClick={() => onSelect(row.ticker)}
              >
                <td className="px-3 py-2 font-medium">{row.ticker}</td>
                <td className="px-3 py-2">{fmtPrice(row.spot)}</td>
                <td className="px-3 py-2">{fmtPrice(row.gammaFlip)}</td>
                <td className="px-3 py-2">{fmtPrice(row.topCallWall)}</td>
                <td className="px-3 py-2">{fmtPrice(row.topPutWall)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
