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
import {
  daysToExpiry,
  fmtFill,
  fmtIv,
  fmtOi,
  fmtOtm,
  fmtSpot,
  ruleLabel,
} from "@/features/helix/lib/helix-flow-format";
import {
  aggressorRead,
  estContractSize,
  estNotional,
  gexProximityLabel,
  printBias,
} from "@/features/helix/lib/helix-print-detail";

/** Kept for callers that only need the contract identity (ticker/strike/expiry/type). */
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

/** Compact notional ($6.0M / $430K) — same thresholds as fmtPremium but without the sign path. */
function fmtNotional(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
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
    <div className="rounded-lg border border-white/[0.08] px-3 py-2 shadow-2xl" style={{ background: 'rgba(8,9,14,0.96)', backdropFilter: 'blur(12px)' }}>
      <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-sky-300/70 mb-1">{row.label}</p>
      <p className="font-mono text-[11px] font-semibold text-white tabular-nums">Vol {row.volume.toLocaleString()}</p>
      <p className="font-mono text-[11px] font-semibold text-cyan-300 tabular-nums">Avg ${row.avg_price.toFixed(2)}</p>
    </div>
  );
}

/** One label/value tile. `est` renders a small "est." tag so derived numbers are never
 *  mistaken for served values (honesty rule). Tiles with a null value are not rendered. */
function PrintStat({
  label,
  value,
  tone,
  est,
}: {
  label: string;
  value: string | null;
  tone?: "bull" | "bear" | "gold" | "neutral";
  est?: boolean;
}) {
  if (value == null || value === "—") return null;
  return (
    <div className="helix-print-stat">
      <span className="helix-print-stat-label">
        {label}
        {est && <span className="helix-print-stat-est">est.</span>}
      </span>
      <span
        className={clsx(
          "helix-print-stat-value",
          tone === "bull" && "text-bull",
          tone === "bear" && "text-bear-text",
          tone === "gold" && "text-gold"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function ContractDrilldownDrawer({
  flow,
  onClose,
  onViewTicker,
}: {
  /** The full clicked print — its own real payload drives the "This print" panel. */
  flow: FlowAlert | null;
  onClose: () => void;
  onViewTicker?: (ticker: string) => void;
}) {
  const [data, setData] = useState<OptionContractDrilldown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (c: FlowAlert) => {
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
    if (flow) void load(flow);
    else {
      setData(null);
      setError(null);
    }
  }, [flow, load]);

  const chartData = useMemo(() => {
    if (!data?.intraday?.length) return [];
    return data.intraday.map((row, i) => ({
      label: row.time ? timeLabel(row.time) : `#${i + 1}`,
      volume: row.volume,
      avg_price: row.avg_price,
    }));
  }, [data]);

  const meta = data?.contract_meta;
  const isCall = flow?.option_type?.toUpperCase() === "CALL";

  // Per-print derived context — all from fields already on the clicked row (no re-fetch).
  const detail = useMemo(() => {
    if (!flow) return null;
    const dte = flow.dte ?? daysToExpiry(flow.expiry);
    const size = estContractSize(flow.premium, flow.fill_price);
    const notional = estNotional(flow.strike, flow.premium, flow.fill_price);
    const aggr = aggressorRead(flow.ask_pct);
    const wall = gexProximityLabel(flow.gex_proximity);
    const bias = printBias(flow);
    return { dte, size, notional, aggr, wall, bias };
  }, [flow]);

  const header = flow ? (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.25em] text-cyan-400/70">
        Contract drilldown
      </span>
      <div className="flex items-center gap-2.5 flex-wrap">
        <h2 className="font-mono text-lg font-bold uppercase tracking-wide text-white">
          {flow.ticker}
          <span className={clsx("ml-1.5", isCall ? "text-bull" : "text-bear-text")}>
            {flow.strike}{isCall ? "C" : "P"}
          </span>
        </h2>
        <span className="font-mono text-[11px] text-sky-300/80">{fmtExpiryShort(flow.expiry)}</span>
        {onViewTicker && (
          <button
            type="button"
            onClick={() => onViewTicker(flow.ticker)}
            className="font-mono text-[10px] font-semibold text-cyan-400/80 hover:text-cyan-200 transition-colors"
          >
            All {flow.ticker} flow →
          </button>
        )}
      </div>
    </div>
  ) : null;

  return (
    <Drawer open={!!flow} onClose={onClose} title={header} size="lg">
      {!flow ? (
        <EmptyState title="Select a contract" description="Click any row on the HELIX tape." />
      ) : (
        <div className="helix-contract-drilldown flex flex-col gap-4">
          {/* ── THIS PRINT ──────────────────────────────────────────────────────
              Every value here is the real payload of the row the user clicked. */}
          {detail && (
            <section className="helix-print-detail desk-panel border border-white/[0.08] rounded-xl p-4">
              <p className="helix-print-detail-title">This print</p>
              <div className="helix-print-stat-grid">
                <PrintStat
                  label="Side"
                  value={isCall ? "CALL" : "PUT"}
                  tone={isCall ? "bull" : "bear"}
                />
                <PrintStat
                  label="Premium"
                  value={fmtPremium(flow.premium)}
                  tone={isCall ? "bull" : "bear"}
                />
                <PrintStat label="Fill / share" value={flow.fill_price != null ? `$${fmtFill(flow.fill_price)}` : null} />
                <PrintStat label="Size" value={detail.size != null ? detail.size.toLocaleString() : null} est />
                <PrintStat label="Notional" value={fmtNotional(detail.notional)} est tone="gold" />
                <PrintStat
                  label="Spot at fill"
                  value={flow.underlying_price ? fmtSpot(flow.underlying_price) : null}
                />
                <PrintStat label="DTE" value={String(detail.dte)} />
                <PrintStat label="OTM" value={fmtOtm(flow.otm_pct)} />
                <PrintStat label="Open int." value={fmtOi(flow.open_interest)} />
                <PrintStat label="IV" value={fmtIv(flow.implied_volatility)} />
                <PrintStat
                  label="Aggressor"
                  value={detail.aggr?.label ?? null}
                  tone={
                    detail.aggr?.tone === "bull" ? "bull" : detail.aggr?.tone === "bear" ? "bear" : "neutral"
                  }
                />
                <PrintStat
                  label="Lean"
                  value={
                    detail.bias === "bullish"
                      ? "Bullish"
                      : detail.bias === "bearish"
                        ? "Bearish"
                        : detail.bias === "neutral"
                          ? "Neutral"
                          : null
                  }
                  tone={
                    detail.bias === "bullish" ? "bull" : detail.bias === "bearish" ? "bear" : "neutral"
                  }
                />
                <PrintStat label="Score" value={flow.score > 0 ? flow.score.toFixed(1) : null} />
              </div>
              {(flow.alert_rule || detail.wall) && (
                <div className="helix-print-tags">
                  {flow.alert_rule && (
                    <span className="helix-print-tag helix-print-tag--rule">{ruleLabel(flow.alert_rule)}</span>
                  )}
                  {detail.wall && (
                    <span className="helix-print-tag helix-print-tag--wall">{detail.wall}</span>
                  )}
                </div>
              )}
              <p className="helix-print-note">
                Size &amp; notional are estimated from premium ÷ fill (×100). Spot, IV, OI &amp; OTM are
                the values captured with the print.
              </p>
            </section>
          )}

          {/* ── CONTRACT ACTIVITY (all prints today) ────────────────────────────
              Aggregate re-fetch keyed by the contract, layered under the single print. */}
          <div className="helix-print-section-head">
            <p className="helix-print-detail-title">Contract activity · all prints today</p>
            {loading && <span className="helix-print-loading">loading…</span>}
          </div>

          {loading ? (
            <div className="space-y-4 p-1">
              <Skeleton width="100%" height={140} rounded="md" />
              <Skeleton width="100%" height={100} rounded="md" />
            </div>
          ) : error ? (
            <EmptyState
              className="!border-transparent !bg-transparent !py-8"
              title="No aggregate contract data"
              description={error}
            />
          ) : !data ? null : (
            <>
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

              <div className="helix-contract-chart-panel desk-panel border border-white/[0.08] rounded-xl p-4">
                <p className="helix-print-detail-title">
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

              <div className="helix-contract-fills desk-panel border border-white/[0.08] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.06]">
                  <p className="helix-print-detail-title !mb-0">
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
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
