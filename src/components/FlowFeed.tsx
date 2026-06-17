"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchFlows, createFlowSocket, fmtPremium, type FlowAlert } from "@/lib/api";
import { clsx } from "clsx";
import { EngineStatusBar } from "@/components/desk/EngineStatusBar";
import { FlowAlertStream } from "@/components/desk/FlowAlertStream";
import { FlowVolumeChart } from "@/components/embeds/FlowVolumeChart";
import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";

const PREMIUM_FILTERS = [100_000, 200_000, 500_000, 1_000_000] as const;
const FLOW_REST_POLL_MS = 30_000;

export function FlowFeed() {
  const [alerts, setAlerts] = useState<FlowAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [minPremium, setMinPremium] = useState(200_000);
  const [tickerFilter, setTickerFilter] = useState("");
  const [live, setLive] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());

  const loadFlows = useCallback(async () => {
    try {
      const d = await fetchFlows({
        limit: 60,
        min_premium: minPremium,
        ticker: tickerFilter || undefined,
      });
      setAlerts(d.flows);
      setLive(true);
    } catch {
      setLive(false);
    } finally {
      setLoading(false);
    }
  }, [minPremium, tickerFilter]);

  useEffect(() => {
    setLoading(true);
    loadFlows();
  }, [loadFlows]);

  useEffect(() => {
    const ws = createFlowSocket((alert) => {
      const id = `${alert.ticker}-${alert.alerted_at}`;
      if (seenRef.current.has(id)) return;
      seenRef.current.add(id);
      setAlerts((prev) => [alert, ...prev.slice(0, 99)]);
      setLive(true);
    });

    if (ws) {
      ws.onerror = () => setLive(false);
      return () => ws.close();
    }

    const interval = setInterval(loadFlows, FLOW_REST_POLL_MS);
    return () => clearInterval(interval);
  }, [loadFlows]);

  return (
    <div className="desk-layout space-y-5">
      <EngineStatusBar />

      <div className="flex flex-wrap items-center gap-3 desk-filter-bar">
        <span className="font-mono text-[9px] tracking-[0.35em] uppercase text-grey-500">Min premium</span>
        {PREMIUM_FILTERS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setMinPremium(v)}
            className={clsx("desk-filter-btn", minPremium === v && "desk-filter-btn-active")}
          >
            {v >= 1_000_000 ? `$${v / 1_000_000}M+` : `$${v / 1000}K+`}
          </button>
        ))}
        <input
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value.toUpperCase())}
          placeholder="Ticker…"
          className="desk-filter-input"
        />
        <span className="ml-auto font-mono text-[10px] text-grey-500">
          {loading ? "Scanning…" : `${alerts.length} alerts · ${fmtPremium(alerts[0]?.premium ?? 0)} latest`}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7">
          <FlowAlertStream flows={alerts} live={live && !loading} />
        </div>
        <div className="xl:col-span-5 space-y-4">
          <FlowVolumeChart alerts={alerts} />
          <TradingViewWidget type="advanced-chart" symbol="NASDAQ:QQQ" title="QQQ Flow Context" height={320} />
        </div>
      </div>
    </div>
  );
}
