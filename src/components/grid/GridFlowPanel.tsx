"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import {
  fetchFlows,
  createFlowEventSource,
  fmtPremium,
  type FlowAlert,
} from "@/lib/api";
import { consumeGridFlowSeed } from "@/lib/grid/grid-flow-seed";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";

const WHALE_PREMIUM = 1_000_000;
const FLOOR_PREMIUM = 1_000_000;
const POLL_MS = 30_000;

/** Stable-ish key for a flow row (matches the HELIX composite when no alert_id rides the row). */
function rowKey(a: FlowAlert & { alert_id?: string }): string {
  return a.alert_id ?? `${a.ticker}|${a.strike}|${a.option_type}|${String(a.alerted_at ?? "").slice(0, 19)}`;
}

/**
 * Panel 3 — Notable / Unusual Flow. REUSES the HELIX flow data plane (fetchFlows REST +
 * createFlowEventSource SSE, the SAME live tape /flows shows) — no new ingest. Compact whale-first
 * rows; a "whale" preset highlights $1M+ prints. Live via the existing flow stream with a 30s poll
 * fallback, so the LIVE badge is honest (green only while the SSE is connected).
 */
function formatDateLabel(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function GridFlowPanel() {
  const { ticker, isFiltered } = useGridTicker();
  const [alerts, setAlerts] = useState<FlowAlert[]>([]);
  const [live, setLive] = useState(false);
  const seenRef = useRef(new Set<string>());

  // SWR fetch for ticker mode (no SSE)
  const { data: tickerFlowData } = useSWR(
    isFiltered && ticker ? `flows-ticker-${ticker}` : null,
    () => fetchFlows({ ticker: ticker!, min_premium: 1_000_000, limit: 200 }),
    { refreshInterval: 60_000 }
  );
  const tickerAlerts: FlowAlert[] = tickerFlowData?.flows ?? [];

  // Date grouping for ticker mode
  const groupedDates = useMemo(() => {
    const byDate = new Map<string, FlowAlert[]>();
    for (const a of tickerAlerts) {
      const day = String(a.alerted_at ?? "").slice(0, 10);
      if (!day) continue;
      const label = formatDateLabel(day);
      if (!byDate.has(label)) byDate.set(label, []);
      byDate.get(label)!.push(a);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 3)
      .map(([dateLabel, rows]) => ({
        dateLabel,
        rows: rows.sort((a, b) => b.premium - a.premium).slice(0, 10),
      }));
  }, [tickerAlerts]);

  const loadFlows = useCallback(async () => {
    try {
      const seed = consumeGridFlowSeed();
      if (seed && !ticker) {
        const seeded = new Set<string>();
        for (const a of seed.flows as Array<FlowAlert & { alert_id?: string }>) seeded.add(rowKey(a));
        seenRef.current = seeded;
        setAlerts(seed.flows);
        setLive(true);
        return;
      }
      const d = await fetchFlows({
        min_premium: FLOOR_PREMIUM,
        limit: 60,
        ...(ticker ? { ticker } : {}),
      });
      const seeded = new Set<string>();
      for (const a of d.flows as Array<FlowAlert & { alert_id?: string }>) seeded.add(rowKey(a));
      seenRef.current = seeded;
      setAlerts(d.flows);
      setLive(true);
    } catch {
      setLive(false);
    }
  }, [ticker]);

  // Reset alerts when ticker changes so stale data doesn't linger
  useEffect(() => {
    setAlerts([]);
    seenRef.current = new Set();
    loadFlows();
  }, [loadFlows, ticker]);

  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | null = null;
    const go = () => { if (!poll) poll = setInterval(loadFlows, POLL_MS); };
    const stop = () => { if (poll) { clearInterval(poll); poll = null; } };

    const conn = createFlowEventSource(
      (alert) => {
        const key = rowKey(alert as FlowAlert & { alert_id?: string });
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
        if (seenRef.current.size > 1000) {
          seenRef.current = new Set(Array.from(seenRef.current).slice(-500));
        }
        setAlerts((prev) => [alert, ...prev].slice(0, 120));
        setLive(true);
      },
      { onOpen: () => { setLive(true); stop(); }, onClose: () => { setLive(false); go(); loadFlows(); } },
      ticker ?? undefined
    );
    if (conn) return () => { conn.close(); stop(); };
    go();
    return () => stop();
  }, [loadFlows, ticker]);

  const rows = useMemo(() => {
    return alerts.slice(0, 40);
  }, [alerts]);

  return (
    <GridCard
      title="Notable Flow"
      kicker="FLOW"
      accent="violet"
      live={isFiltered && ticker ? tickerFlowData != null : live}
      span={1}
      footer={<span className="grid-foot-note">HELIX tape · educational, not advice</span>}
    >
      {isFiltered && ticker ? (
        // Ticker mode: date-grouped last-3-days view
        <>
          <p className="grid-ticker-badge">Showing {ticker} flow ($1M+)</p>
          {groupedDates.length === 0 ? (
            <p className="grid-empty">
              {tickerFlowData ? `No $1M+ flow for ${ticker}` : "Loading flow…"}
            </p>
          ) : (
            groupedDates.map(({ dateLabel, rows: dateRows }) => (
              <div key={dateLabel}>
                <p className="text-[10px] text-sky-400/60 uppercase tracking-wider px-2 py-1 border-b border-white/5">{dateLabel}</p>
                <ul>
                  {dateRows.map((row, i) => (
                    <li key={`${row.strike}-${i}`} className="grid-flow-row">
                      <span className="grid-flow-strike">${row.strike}</span>
                      <span className={clsx("grid-flow-type", row.option_type === "CALL" ? "pulse-tone-emerald" : "pulse-tone-bear")}>{row.option_type}</span>
                      <span className={clsx("grid-flow-prem", row.option_type === "CALL" ? "pulse-tone-emerald" : "pulse-tone-bear")}>{fmtPremium(row.premium)}</span>
                      {row.premium >= 1_000_000 && <span className="grid-flow-whale" aria-hidden>🐋</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </>
      ) : (
        // Market-wide mode: SSE live stream
        <>
          {rows.length === 0 ? (
            <p className="grid-empty">
              {live ? "Wire quiet — no prints" : "Acquiring flow tape…"}
            </p>
          ) : (
            <ul className="grid-flow-list">
              {rows.map((a) => {
                const isCall = a.option_type === "CALL";
                const whale = a.premium >= WHALE_PREMIUM;
                return (
                  <li key={rowKey(a as FlowAlert & { alert_id?: string })} className={clsx("grid-flow-row", whale && "grid-flow-row-whale")}>
                    <span className="grid-flow-ticker">{a.ticker}</span>
                    <span className={clsx("grid-flow-type", isCall ? "pulse-tone-emerald" : "pulse-tone-bear")}>
                      {a.option_type}
                    </span>
                    <span className="grid-flow-strike">${a.strike}</span>
                    <span className={clsx("grid-flow-prem", isCall ? "pulse-tone-emerald" : "pulse-tone-bear")}>
                      {fmtPremium(a.premium)}
                    </span>
                    {whale && <span className="grid-flow-whale" aria-hidden>🐋</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </GridCard>
  );
}
