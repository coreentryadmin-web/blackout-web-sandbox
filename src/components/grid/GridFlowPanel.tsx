"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { clsx } from "clsx";
import {
  fetchFlows,
  createFlowEventSource,
  fmtPremium,
  type FlowAlert,
} from "@/lib/api";
import { GridCard } from "./GridCard";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";

const WHALE_PREMIUM = 1_000_000;
const FLOOR_PREMIUM = 200_000;
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
export function GridFlowPanel() {
  const { ticker, isFiltered } = useGridTicker();
  const [alerts, setAlerts] = useState<FlowAlert[]>([]);
  const [live, setLive] = useState(false);
  const [whaleOnly, setWhaleOnly] = useState(false);
  const seenRef = useRef(new Set<string>());

  const loadFlows = useCallback(async () => {
    try {
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
        // When filtering by ticker, drop SSE events that don't match
        if (ticker && alert.ticker?.toUpperCase() !== ticker) return;
        const key = rowKey(alert as FlowAlert & { alert_id?: string });
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
        if (seenRef.current.size > 1000) {
          seenRef.current = new Set(Array.from(seenRef.current).slice(-500));
        }
        setAlerts((prev) => [alert, ...prev].slice(0, 120));
        setLive(true);
      },
      { onOpen: () => { setLive(true); stop(); }, onClose: () => { setLive(false); go(); loadFlows(); } }
    );
    if (conn) return () => { conn.close(); stop(); };
    go();
    return () => stop();
  }, [loadFlows, ticker]);

  const rows = useMemo(() => {
    const base = whaleOnly ? alerts.filter((a) => a.premium >= WHALE_PREMIUM) : alerts;
    return base.slice(0, 40);
  }, [alerts, whaleOnly]);

  return (
    <GridCard
      title="Notable Flow"
      kicker="FLOW"
      accent="violet"
      live={live}
      span={1}
      actions={
        <button
          type="button"
          onClick={() => setWhaleOnly((v) => !v)}
          className={clsx("grid-chip-btn", whaleOnly && "grid-chip-btn-active")}
          title="Show only whale prints ($1M+)"
        >
          🐋 {whaleOnly ? "WHALE" : "ALL"}
        </button>
      }
      footer={<span className="grid-foot-note">HELIX tape · educational, not advice</span>}
    >
      {isFiltered && ticker && (
        <p className="grid-ticker-badge">Showing {ticker} flow</p>
      )}
      {rows.length === 0 ? (
        <p className="grid-empty">
          {live
            ? isFiltered && ticker
              ? `No flow for ${ticker} above $${(FLOOR_PREMIUM / 1000).toFixed(0)}K`
              : "Wire quiet — no prints"
            : "Acquiring flow tape…"}
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
    </GridCard>
  );
}
