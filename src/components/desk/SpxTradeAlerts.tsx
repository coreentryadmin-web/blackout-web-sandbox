"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { computeSpxTradeSignal, type SpxSignalAction, type SpxTradeSignal } from "@/lib/spx-signals";
import { fmtPrice } from "@/lib/api";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  refreshing?: boolean;
};

type AlertRow = SpxTradeSignal & { id: string };

function actionClass(action: SpxSignalAction): string {
  switch (action) {
    case "BUY_CALL":
      return "spx-alert-buy-call";
    case "BUY_PUT":
      return "spx-alert-buy-put";
    case "HOLD":
      return "spx-alert-hold";
    default:
      return "spx-alert-wait";
  }
}

function actionLabel(action: SpxSignalAction): string {
  switch (action) {
    case "BUY_CALL":
      return "BUY CALL";
    case "BUY_PUT":
      return "BUY PUT";
    case "HOLD":
      return "HOLD";
    default:
      return "WAIT";
  }
}

function signalId(s: SpxTradeSignal): string {
  return `${s.action}|${s.confidence}|${Math.round(s.score)}|${s.headline}`;
}

export function SpxTradeAlerts({ desk, live, refreshing }: Props) {
  const signal = useMemo(() => (desk ? computeSpxTradeSignal(desk) : null), [desk]);
  const [history, setHistory] = useState<AlertRow[]>([]);
  const lastIdRef = useRef<string>("");

  useEffect(() => {
    if (!signal) return;
    const id = signalId(signal);
    if (id === lastIdRef.current) return;
    lastIdRef.current = id;
    setHistory((prev) => [{ ...signal, id: `${id}|${Date.now()}` }, ...prev].slice(0, 24));
  }, [signal]);

  const updatedAt = signal?.as_of
    ? new Date(signal.as_of).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <section
      className={clsx(
        "spx-trade-alerts-panel",
        refreshing && signal && "spx-desk-panel-refreshing"
      )}
    >
      <header className="spx-trade-alerts-header">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-grey-500">
            0DTE SPX
          </p>
          <h2 className="font-display text-lg text-white tracking-wide">Trade Alerts</h2>
          <p className="font-mono text-[10px] text-grey-500 mt-0.5">
            Confluence · GEX + flow + internals {live ? `· ${updatedAt}` : ""}
          </p>
        </div>
        <span
          className={clsx(
            "spx-live-pill",
            live ? "spx-live-pill-on" : "spx-live-pill-off"
          )}
        >
          {live ? "LIVE" : "OFFLINE"}
        </span>
      </header>

      {!signal ? (
        <p className="font-mono text-[11px] text-grey-500 py-8 text-center">
          Building confluence model…
        </p>
      ) : (
        <>
          <div className={clsx("spx-trade-alert-hero", actionClass(signal.action))}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="spx-trade-alert-action">{actionLabel(signal.action)}</p>
                <p className="spx-trade-alert-headline">{signal.headline}</p>
                <p className="font-mono text-[11px] text-grey-300 mt-2 leading-relaxed">
                  {signal.thesis}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-[9px] uppercase text-grey-500">Score</p>
                <p
                  className={clsx(
                    "font-mono text-2xl font-bold tabular-nums",
                    signal.score > 0 ? "text-bull" : signal.score < 0 ? "text-bear" : "text-grey-200"
                  )}
                >
                  {signal.score > 0 ? "+" : ""}
                  {signal.score}
                </p>
                <p className="font-mono text-[10px] text-grey-400 mt-1">
                  {signal.confidence}% conf
                </p>
              </div>
            </div>

            <div className="spx-trade-alert-levels mt-4 grid grid-cols-3 gap-2">
              <div>
                <p className="font-mono text-[9px] uppercase text-grey-500">Entry</p>
                <p className="font-mono text-sm text-white tabular-nums">
                  {fmtPrice(signal.levels.entry)}
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase text-grey-500">Stop</p>
                <p className="font-mono text-sm text-bear tabular-nums">
                  {signal.levels.stop != null ? fmtPrice(signal.levels.stop) : "—"}
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase text-grey-500">Target</p>
                <p className="font-mono text-sm text-bull tabular-nums">
                  {signal.levels.target != null ? fmtPrice(signal.levels.target) : "—"}
                </p>
              </div>
            </div>
            <p className="font-mono text-[10px] text-amber-200/80 mt-2">
              Invalidation: {signal.levels.invalidation}
            </p>
          </div>

          <div className="spx-trade-factors mt-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-grey-500 mb-2">
              Confluence factors
            </p>
            <ul className="spx-desk-list">
              {signal.factors.slice(0, 10).map((f) => (
                <li key={`${f.label}-${f.detail}`} className="spx-desk-list-row">
                  <span
                    className={clsx(
                      "font-mono text-[10px] uppercase w-24 shrink-0 font-bold",
                      f.weight > 0 ? "text-bull" : f.weight < 0 ? "text-bear" : "text-grey-400"
                    )}
                  >
                    {f.label}
                  </span>
                  <span className="font-mono text-[11px] text-grey-300 flex-1">{f.detail}</span>
                  <span
                    className={clsx(
                      "font-mono text-[10px] tabular-nums shrink-0",
                      f.weight > 0 ? "text-bull" : f.weight < 0 ? "text-bear" : "text-grey-500"
                    )}
                  >
                    {f.weight > 0 ? "+" : ""}
                    {f.weight}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {history.length > 1 && (
        <div className="spx-trade-alert-history mt-4 pt-4 border-t border-white/5">
          <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-grey-500 mb-2">
            Alert log
          </p>
          <ul className="spx-desk-list max-h-[200px] overflow-y-auto">
            {history.slice(1, 10).map((row) => (
              <li key={row.id} className="spx-desk-list-row text-[11px]">
                <span
                  className={clsx(
                    "font-mono uppercase text-[9px] w-16 shrink-0 font-bold",
                    row.action === "BUY_CALL"
                      ? "text-bull"
                      : row.action === "BUY_PUT"
                        ? "text-bear"
                        : "text-grey-400"
                  )}
                >
                  {actionLabel(row.action)}
                </span>
                <span className="font-mono text-grey-400 shrink-0">
                  {new Date(row.as_of).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className="font-mono text-grey-300 truncate">{row.headline}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
