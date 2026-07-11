"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { clsx } from "clsx";
import { Drawer, Skeleton, EmptyState } from "@/components/ui";
import { fmtPremium, fetchOptionContractDrilldown, type OptionContractDrilldown } from "@/lib/api";
import type { FlowAlert } from "@/lib/api";

export type ContractPick = Pick<FlowAlert, "ticker" | "strike" | "expiry" | "option_type">;

function fmtExpiryShort(expiry: string): string {
  const [y, m, d] = expiry.split("-");
  if (!y || !m || !d) return expiry;
  return `${m}/${d}/${y.slice(2)}`;
}

function timeLabel(iso: string): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso.slice(11, 16) || "—";
  return new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { label: string; volume: number; avg_price: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-md border border-white/10 bg-[rgba(8,9,14,0.95)] px-2.5 py-1.5 shadow-xl">
      <p className="font-mono text-[10px] text-sky-300">{row.label}</p>
      <p className="font-mono text-[10px] text-white">Vol {row.volume.toLocaleString()}</p>
      <p className="font-mono text-[10px] text-cyan-300">Avg ${row.avg_price.toFixed(2)}</p>
    </div>
  );
}

export function ContractDrilldownDrawer({
  contract,
  onClose,
  onViewTicker,
}: {
  contract: ContractPick | null;
  onClose: () => void;
  onViewTicker?: (ticker: string) => void;
}) {
  const [data, setData] = useState<OptionContractDrilldown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (c: ContractPick) => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchOptionContractDrilldown({
        ticker: c.ticker,
        strike: c.strike,
        expiry: c.expiry,
        option_type: c.option_type.toUpperCase() === "PUT" ? "PUT" : "CALL",
      });
      setData(d);
    } catch {
      setError("Contract data unavailable");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (contract) void load(contract);
    else {
      setData(null);
      setError(null);
    }
  }, [contract, load]);

  const chartData = useMemo(() => {
    if (!data?.intraday?.length) return [];
    return data.intraday.map((row, i) => ({
      label: row.time ? timeLabel(row.time) : `#${i + 1}`,
      volume: row.volume,
      avg_price: row.avg_price,
    }));
  }, [data]);

  const meta = data?.contract_meta;

  const isCall = contract?.option_type?.toUpperCase() === "CALL";

  const header = contract ? (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400/80">
        Contract drilldown
      </span>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="t-label text-lg uppercase text-white">
          {contract.ticker} {contract.strike}
          {isCall ? "C" : "P"}
        </h2>
        <span className="font-mono text-[11px] text-sky-300">{fmtExpiryShort(contract.expiry)}</span>
        {onViewTicker && (
          <button
            type="button"
            onClick={() => onViewTicker(contract.ticker)}
            className="font-mono text-[10px] text-cyan-400 hover:text-sky-200 underline underline-offset-2"
          >
            All {contract.ticker} flow →
          </button>
        )}
      </div>
    </div>
  ) : null;

  return (
    <Drawer open={!!contract} onClose={onClose} title={header} size="lg">
      {loading ? (
        <div className="space-y-4 p-1">
          <Skeleton width="100%" height={160} rounded="md" />
          <Skeleton width="100%" height={120} rounded="md" />
        </div>
      ) : error ? (
        <EmptyState title="No contract data" description={error} />
      ) : !data ? (
        <EmptyState title="Select a contract" description="Click any row on the HELIX tape." />
      ) : (
        <div className="helix-contract-drilldown flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            {meta?.open_interest != null && (
              <div className="helix-contract-stat">
                <span className="helix-contract-stat-label">Open interest</span>
                <span className="helix-contract-stat-value">{meta.open_interest.toLocaleString()}</span>
              </div>
            )}
            {meta?.day_volume != null && (
              <div className="helix-contract-stat">
                <span className="helix-contract-stat-label">Day volume</span>
                <span className="helix-contract-stat-value">{meta.day_volume.toLocaleString()}</span>
              </div>
            )}
            {data.bid_share_pct != null && (
              <div className="helix-contract-stat">
                <span className="helix-contract-stat-label">Bid share</span>
                <span className="helix-contract-stat-value">{data.bid_share_pct}%</span>
              </div>
            )}
            {meta?.iv != null && (
              <div className="helix-contract-stat">
                <span className="helix-contract-stat-label">IV</span>
                <span className="helix-contract-stat-value">{meta.iv.toFixed(1)}%</span>
              </div>
            )}
            <div className="helix-contract-stat">
              <span className="helix-contract-stat-label">Fills</span>
              <span className="helix-contract-stat-value">{data.fill_count}</span>
            </div>
          </div>

          <div className="helix-contract-chart-panel desk-panel border border-white/10 rounded-lg p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-purple-light mb-2">
              Intraday volume · avg price
            </p>
            {chartData.length < 2 ? (
              <div className="h-[140px] flex items-center justify-center">
                <span className="font-mono text-[10px] text-sky-300/70">No intraday series yet</span>
              </div>
            ) : (
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#7dd3fc", fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis
                      yAxisId="vol"
                      tick={{ fill: "#94a3b8", fontSize: 9 }}
                      width={36}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <YAxis
                      yAxisId="price"
                      orientation="right"
                      tick={{ fill: "#22d3ee", fontSize: 9 }}
                      width={40}
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar yAxisId="vol" dataKey="volume" fill="rgba(148,163,184,0.55)" radius={[2, 2, 0, 0]} />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="avg_price"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="helix-contract-fills desk-panel border border-white/10 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-white/8">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-purple-light">
                Contract flow data
              </p>
            </div>
            {data.fills.length === 0 ? (
              <EmptyState
                className="!border-transparent !bg-transparent !py-10"
                title="No fills"
                description="UW returned no per-contract prints for this leg."
              />
            ) : (
              <div className="helix-contract-fills-scroll max-h-[280px] overflow-auto flow-scroll">
                <table className="helix-contract-fills-table w-full">
                  <thead>
                    <tr>
                      <th>Size</th>
                      <th className="text-right">Fill</th>
                      <th className="text-right">Premium</th>
                      <th className="text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fills.map((f, i) => (
                      <tr key={`${f.time}-${i}`}>
                        <td className="tabular-nums">{f.size > 0 ? f.size.toLocaleString() : "—"}</td>
                        <td className="text-right tabular-nums text-gold">
                          {f.fill != null ? `$${f.fill.toFixed(2)}` : "—"}
                        </td>
                        <td
                          className={clsx(
                            "text-right tabular-nums font-semibold",
                            isCall ? "text-bull" : "text-bear-text"
                          )}
                        >
                          {fmtPremium(f.premium)}
                        </td>
                        <td className="text-right tabular-nums text-sky-300/80">{timeLabel(f.time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
