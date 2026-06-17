"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxPlayPayload, SpxPlayAction } from "@/lib/spx-play-engine";
import { useSpxPlay } from "@/hooks/useSpxPlay";
import { useStablePlayConfirmations } from "@/hooks/useStablePlayConfirmations";
import { fmtPrice } from "@/lib/api";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  refreshing?: boolean;
  sessionActive?: boolean;
};

type HistoryRow = SpxPlayPayload & { id: string };

function actionClass(action: SpxPlayAction): string {
  switch (action) {
    case "BUY":
      return "spx-alert-buy-call";
    case "SELL":
      return "spx-alert-buy-put";
    case "HOLD":
    case "TRIM":
      return "spx-alert-hold";
    case "WATCHING":
      return "spx-alert-wait";
    default:
      return "spx-alert-scanning";
  }
}

function actionLabel(action: SpxPlayAction, direction: SpxPlayPayload["direction"]): string {
  switch (action) {
    case "BUY":
      return direction === "short" ? "BUY PUT" : "BUY CALL";
    case "SELL":
      return "SELL";
    case "HOLD":
      return "HOLD";
    case "TRIM":
      return "TRIM";
    case "WATCHING":
      return "WATCH";
    default:
      return "SCANNING";
  }
}

function historyClass(action: SpxPlayAction): string {
  switch (action) {
    case "BUY":
      return "spx-history-buy-call";
    case "SELL":
      return "spx-history-buy-put";
    case "HOLD":
    case "TRIM":
      return "spx-history-hold";
    default:
      return "spx-history-wait";
  }
}

function scoreClass(action: SpxPlayAction, score: number): string {
  if (action === "BUY") return score >= 0 ? "text-bull" : "text-bear";
  if (action === "SELL") return "text-bear";
  if (action === "HOLD" || action === "TRIM" || action === "WATCHING") return "text-orange-400";
  return "text-grey-400";
}

function playId(p: SpxPlayPayload): string {
  return `${p.action}|${p.direction}|${p.confidence}|${Math.round(p.score)}|${p.headline}`;
}

export function SpxTradeAlerts({ desk, live, refreshing, sessionActive = true }: Props) {
  const { play, playRefreshing } = useSpxPlay(sessionActive);
  const confirmationLayer = useStablePlayConfirmations(play);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const lastIdRef = useRef<string>("");

  useEffect(() => {
    if (!play || play.action === "SCANNING") return;
    const id = playId(play);
    if (id === lastIdRef.current) return;
    lastIdRef.current = id;
    setHistory((prev) => [{ ...play, id: `${id}|${Date.now()}` }, ...prev].slice(0, 24));
  }, [play]);

  const show = play != null;
  const updatedAt = play?.as_of
    ? new Date(play.as_of).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  const panelRefreshing = (refreshing || playRefreshing) && play && play.action !== "SCANNING";

  const showConfirmationPanel =
    Boolean(confirmationLayer) &&
    (play?.action === "SCANNING" ||
      play?.action === "WATCHING" ||
      (!play && playRefreshing));

  return (
    <section
      className={clsx(
        "spx-trade-alerts-panel",
        panelRefreshing && "spx-desk-panel-refreshing"
      )}
    >
      <header className="spx-trade-alerts-header">
        <div>
          <p className="spx-trade-alerts-kicker">0DTE SPX · Play Engine</p>
          <h2 className="spx-trade-alerts-title font-display">Trade Alerts</h2>
          <p className="spx-trade-alerts-sub">
            Confluence · MTF · news · flow · S/R {live ? `· ${updatedAt}` : ""}
          </p>
        </div>
        <span className={clsx("spx-live-pill", live ? "spx-live-pill-on" : "spx-live-pill-off")}>
          {live ? "LIVE" : "OFFLINE"}
        </span>
      </header>

      {!show ? (
        <p className="font-mono text-[11px] text-grey-500 py-8 text-center">
          {live ? "Loading play engine…" : "Session closed · resumes 6:30 AM PT"}
        </p>
      ) : (
        <>
          <div className={clsx("spx-trade-alert-hero", actionClass(play.action))}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="spx-trade-alert-action">{actionLabel(play.action, play.direction)}</p>
                <p className="spx-trade-alert-headline">{play.headline}</p>
                {play.option_ticket && play.action === "BUY" && (
                  <p className="spx-trade-option-ticket">
                    {play.option_ticket.contract_label} · ${play.option_ticket.premium_range}
                    {play.option_ticket.delta != null
                      ? ` · Δ ${Math.abs(play.option_ticket.delta).toFixed(2)}`
                      : ""}
                  </p>
                )}
                <p className="spx-trade-alert-thesis">{play.thesis}</p>
                {play.grade && play.action !== "SCANNING" && (
                  <p className="spx-trade-grade-line">
                    Grade {play.grade}
                    {play.open_play ? ` · open ${play.open_play.direction}` : ""}
                    {play.watch?.active ? " · WATCH active" : ""}
                    {play.watch?.promote_ready ? " · promote ready" : ""}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="spx-trade-alert-score-label">Score</p>
                <p className={clsx("spx-trade-alert-score", scoreClass(play.action, play.score))}>
                  {play.score > 0 ? "+" : ""}
                  {play.score}
                </p>
                <p className="spx-trade-alert-conf-pct">{play.confidence}% conf</p>
              </div>
            </div>

            {play.levels.entry != null && play.action !== "SCANNING" && play.action !== "WATCHING" && (
              <div className="spx-trade-alert-levels mt-5 grid grid-cols-3 gap-4">
                <div>
                  <p className="spx-trade-alert-score-label">Entry</p>
                  <p className={clsx("spx-level-value", scoreClass(play.action, play.score))}>
                    {fmtPrice(play.levels.entry)}
                  </p>
                </div>
                <div>
                  <p className="spx-trade-alert-score-label">Stop</p>
                  <p className="spx-level-value text-bear tabular-nums">
                    {play.levels.stop != null ? fmtPrice(play.levels.stop) : "—"}
                  </p>
                </div>
                <div>
                  <p className="spx-trade-alert-score-label">Target</p>
                  <p className="spx-level-value text-bull tabular-nums">
                    {play.levels.target != null ? fmtPrice(play.levels.target) : "—"}
                  </p>
                </div>
              </div>
            )}

            {play.levels.invalidation && play.phase === "OPEN" && (
              <p className="font-mono text-xs text-orange-200/70 mt-3">
                Invalidation: {play.levels.invalidation}
              </p>
            )}

            {play.claude && play.action === "BUY" && (
              <p className="font-mono text-[10px] text-emerald-300/70 mt-2">
                Claude {play.claude.source} · {play.claude.verdict}
              </p>
            )}
          </div>

          {showConfirmationPanel && confirmationLayer && (
              <div
                className={clsx(
                  "spx-trade-confirmations",
                  playRefreshing && "spx-trade-confirmations-refreshing"
                )}
              >
                <p className="spx-trade-confirmations-title">
                  Confirmations {confirmationLayer.confirmations.passed_count}/
                  {confirmationLayer.confirmations.total}
                  {playRefreshing && (
                    <span className="ml-2 text-grey-500 font-normal normal-case tracking-normal">
                      · updating
                    </span>
                  )}
                </p>
                {confirmationLayer.confirmations.checks.map((c) => (
                  <p
                    key={c.label}
                    className={c.passed ? "spx-trade-confirmation-pass" : "spx-trade-confirmation-fail"}
                  >
                    {c.passed ? "✓" : "✗"} {c.label}: {c.detail}
                  </p>
                ))}
                {confirmationLayer.technicals && (
                  <p className="spx-trade-confirmation-meta">
                    5m {confirmationLayer.technicals.m5_trend} · RSI{" "}
                    {confirmationLayer.technicals.m5_rsi?.toFixed(0) ?? "—"} · 3m{" "}
                    {confirmationLayer.technicals.m3_close?.toFixed(2) ?? "—"}
                    {confirmationLayer.technicals.mtf_summary
                      ? ` · ${confirmationLayer.technicals.mtf_summary}`
                      : ""}
                  </p>
                )}
                {confirmationLayer.watch?.active && (
                  <p className="spx-trade-confirmation-meta text-amber-300/90">
                    WATCH since{" "}
                    {confirmationLayer.watch.since
                      ? new Date(confirmationLayer.watch.since).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}{" "}
                    · {confirmationLayer.watch.reason}
                  </p>
                )}
                {confirmationLayer.telemetry?.adaptive_active && (
                  <p className="spx-trade-confirmation-meta text-violet-300/80">
                    Telemetry: {confirmationLayer.telemetry.summary}
                    {confirmationLayer.telemetry.cold_buy_win_rate != null
                      ? ` · cold ${(confirmationLayer.telemetry.cold_buy_win_rate * 100).toFixed(0)}%`
                      : ""}
                    {confirmationLayer.telemetry.promote_win_rate != null
                      ? ` · promote ${(confirmationLayer.telemetry.promote_win_rate * 100).toFixed(0)}%`
                      : ""}
                  </p>
                )}
                {confirmationLayer.gates.blocks.slice(0, 2).map((b) => (
                  <p key={b} className="spx-trade-block-warn">
                    ⛔ {b}
                  </p>
                ))}
              </div>
            )}

          {play.factors.length > 0 && play.action !== "SCANNING" && (
            <div className="spx-trade-factors mt-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-grey-500 mb-2">
                Confluence factors
              </p>
              <ul className="spx-desk-list">
                {play.factors.slice(0, 10).map((f) => (
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
          )}
        </>
      )}

      {history.length > 1 && (
        <div className="spx-trade-alert-history mt-4 pt-4 border-t border-white/5">
          <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-grey-500 mb-2">
            Play log
          </p>
          <ul className="spx-desk-list max-h-[200px] overflow-y-auto">
            {history.slice(1, 10).map((row) => (
              <li key={row.id} className="spx-desk-list-row text-xs md:text-sm">
                <span className={clsx("spx-trade-alert-history-action", historyClass(row.action))}>
                  {actionLabel(row.action, row.direction)}
                </span>
                <span className="font-mono text-grey-500 shrink-0">
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
