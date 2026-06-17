"use client";

import { useState, useEffect, useRef } from "react";
import { fetchFlows, createFlowSocket, fmtPremium, fmtPrice, type FlowAlert } from "@/lib/api";
import { clsx } from "clsx";
import { PlatformEmpty } from "@/components/platform/PlatformEmpty";
import { FlowsEmbeds } from "@/components/embeds/FlowsEmbeds";

const ROUTE_COLORS: Record<string, string> = {
  whale: "text-yellow-500 border-yellow-900/40",
  stock: "text-blue-400 border-blue-900/40",
  "0dte": "text-purple-400 border-purple-900/40",
  ideal: "text-white border-white/20",
};

function FlowRow({ alert, fresh }: { alert: FlowAlert; fresh?: boolean }) {
  const isBull = alert.direction === "bullish" || alert.option_type?.toUpperCase() === "CALL";
  return (
    <tr className={clsx("group transition-colors", fresh && "animate-slide-up")}>
      <td className="py-3 px-4">
        <span className="font-mono text-[13px] font-semibold text-white">{alert.ticker}</span>
      </td>
      <td className="py-3 px-4">
        <span className={clsx("font-mono text-[13px]", isBull ? "num-bull" : "num-bear")}>
          {alert.option_type?.toUpperCase() || "—"}
        </span>
      </td>
      <td className="py-3 px-4 font-mono text-[13px] text-text-secondary">
        {fmtPrice(alert.strike)}
      </td>
      <td className="py-3 px-4 font-mono text-[12px] text-text-muted">
        {alert.expiry || "—"}
      </td>
      <td className="py-3 px-4">
        <span className={clsx("font-mono text-[13px] font-semibold", isBull ? "num-bull" : "num-bear")}>
          {fmtPremium(alert.premium)}
        </span>
      </td>
      <td className="py-3 px-4">
        <span className={clsx("text-[10px] tracking-[1px] uppercase px-2 py-0.5 border", ROUTE_COLORS[alert.route] ?? "text-text-muted border-surface-3")}>
          {alert.route}
        </span>
      </td>
      <td className="py-3 px-4 font-mono text-[12px] text-text-muted">
        {alert.score?.toFixed(1) ?? "—"}
      </td>
      <td className="py-3 px-4 font-mono text-[11px] text-surface-4">
        {alert.alerted_at ? new Date(alert.alerted_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}
      </td>
    </tr>
  );
}

export function FlowFeed() {
  const [alerts, setAlerts] = useState<FlowAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [minPremium, setMinPremium] = useState(200_000);
  const [tickerFilter, setTickerFilter] = useState("");
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  // Initial load
  useEffect(() => {
    fetchFlows({ limit: 50, min_premium: minPremium, ticker: tickerFilter || undefined })
      .then((d) => { setAlerts(d.flows); setLoading(false); })
      .catch(() => setLoading(false));
  }, [minPremium, tickerFilter]);

  // WebSocket live updates
  useEffect(() => {
    const ws = createFlowSocket((alert) => {
      setAlerts((prev) => [alert, ...prev.slice(0, 99)]);
      const id = `${alert.ticker}-${alert.alerted_at}`;
      setFreshIds((s) => new Set(s).add(id));
      setTimeout(() => setFreshIds((s) => { const n = new Set(s); n.delete(id); return n; }), 2000);
    });
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  return (
    <div className="space-y-4">
      <FlowsEmbeds alerts={alerts} />
      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-[2px] uppercase text-text-muted">Min Premium</span>
          {[100_000, 200_000, 500_000, 1_000_000].map((v) => (
            <button
              key={v}
              onClick={() => setMinPremium(v)}
              className={clsx(
                "px-3 py-1.5 text-[10px] tracking-[1px] uppercase border transition-colors",
                minPremium === v
                  ? "border-white/30 text-white"
                  : "border-surface-3 text-text-muted hover:border-surface-4"
              )}
            >
              {v >= 1_000_000 ? `$${v / 1_000_000}M+` : `$${v / 1000}K+`}
            </button>
          ))}
        </div>
        <input
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value.toUpperCase())}
          placeholder="Filter ticker…"
          className="bg-surface-1 border border-surface-3 px-3 py-1.5 text-[12px] font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-surface-4 w-32"
        />
      </div>

      {/* Table */}
      {!loading && alerts.length === 0 ? (
        <PlatformEmpty
          variant="flows"
          title="NO WHALES YET"
          description="Flow alerts stream live during market hours. Lower the premium filter or check back when RTH opens."
        />
      ) : (
      <div className="card overflow-hidden border-purple/20">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Type</th>
              <th>Strike</th>
              <th>Expiry</th>
              <th>Premium</th>
              <th>Route</th>
              <th>Score</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12 text-purple-light/80 text-[13px] font-mono">Scanning institutional tape…</td></tr>
            ) : (
              alerts.map((a, i) => {
                const id = `${a.ticker}-${a.alerted_at}`;
                return <FlowRow key={`${id}-${i}`} alert={a} fresh={freshIds.has(id)} />;
              })
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
