"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxPlayPayload, SpxPlayAction } from "@/lib/spx-play-engine";
import { useSpxPlay } from "@/hooks/useSpxPlay";
import { useSpxLotto } from "@/hooks/useSpxLotto";
import { useStablePlayConfirmations } from "@/hooks/useStablePlayConfirmations";
import { SpxSniperBackdrop } from "@/components/desk/SpxSniperBackdrop";
import { fmtPrice } from "@/lib/api";
import type { LottoPlayPayload } from "@/lib/spx-lotto-engine";
import { isLottoWindow } from "@/lib/spx-play-session-guards";
import {
  lottoPanelEmptyCopy,
  lottoPanelLoadingCopy,
  lottoPanelOffHoursCopy,
} from "@/lib/spx-lotto-copy";

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

function isPlayIdeaLine(line: string): boolean {
  return (
    line.startsWith("I like ") ||
    line.startsWith("Leaning ") ||
    line.startsWith("Tape's mixed") ||
    line.includes(" could be the play") ||
    line.includes(" is the play")
  );
}

function isDeskOfflineCopy(text: string | undefined): boolean {
  if (!text) return false;
  return (
    text.startsWith("Desk offline") ||
    text.includes("resumes 6:30 AM PT") ||
    text.includes("Session closed")
  );
}

function playId(p: SpxPlayPayload): string {
  return `${p.action}|${p.direction}|${p.confidence}|${Math.round(p.score)}|${p.headline}`;
}

function LottoPlayBlock({
  lotto,
  lottoLoading,
  lottoRefreshing,
}: {
  lotto: LottoPlayPayload | null;
  lottoLoading: boolean;
  lottoRefreshing: boolean;
}) {
  const inWindow = isLottoWindow();

  if (lotto && lotto.phase !== "NONE") {
    return (
      <div
        className={clsx(
          "spx-lotto-play-block",
          lotto.phase === "WATCH" && "spx-lotto-play-block-watch",
          (lotto.phase === "BUY" || lotto.phase === "HOLD") && "spx-lotto-play-block-ready",
          lotto.phase === "INVALID" && "spx-lotto-play-block-invalid"
        )}
      >
        <p className="spx-lotto-play-kicker">{lotto.status_label}</p>
        <p className="spx-lotto-play-headline">{lotto.headline}</p>
        {lotto.thesis && lotto.thesis !== lotto.headline && (
          <p className="spx-lotto-play-thesis">{lotto.thesis}</p>
        )}
        {lotto.contract_label && (
          <p className="spx-lotto-play-contract">
            {lotto.direction === "long" ? "CALL" : "PUT"} · Strike {lotto.strike}
            {lotto.premium_estimate ? ` · ${lotto.premium_estimate}` : ""}
          </p>
        )}
        {lotto.target_price != null && lotto.entry_zone != null && (
          <p className="spx-lotto-play-contract">
            Target: +{lotto.target_pts} pts · Zone: {lotto.entry_zone.toFixed(0)}
          </p>
        )}
        {lotto.entry_trigger && lotto.phase === "WATCH" && (
          <p className="spx-lotto-play-contract">Confirm: {lotto.entry_trigger}</p>
        )}
        {lotto.open_anchor_price != null && lotto.phase === "WATCH" && (
          <p className="spx-lotto-play-anchor">
            Open anchor: {lotto.open_anchor_price.toFixed(2)} (9:30 cash print)
          </p>
        )}
        {lotto.invalidation && lotto.phase === "WATCH" && (
          <p className="spx-lotto-play-invalidation">{lotto.invalidation}</p>
        )}
        {lotto.catalyst_summary && lotto.phase === "WATCH" && (
          <p className="spx-lotto-play-flow">Intel: {lotto.catalyst_summary}</p>
        )}
        {lotto.flow_summary && <p className="spx-lotto-play-flow">Flow: {lotto.flow_summary}</p>}
        {lotto.sizing_note && <p className="spx-lotto-play-sizing">{lotto.sizing_note}</p>}
        {lotto.spread_pct != null && (
          <p className="spx-lotto-play-spread">Spread: {lotto.spread_pct.toFixed(0)}% (lotto cap)</p>
        )}
        <p className="spx-lotto-play-footnote">
          {lotto.status_message}
          {lottoRefreshing && " · live"}
        </p>
      </div>
    );
  }

  if (inWindow) {
    const copy = lottoLoading
      ? lottoPanelLoadingCopy()
      : lottoPanelEmptyCopy(lotto?.headline);
    return (
      <div className="spx-lotto-play-block spx-lotto-play-block-empty">
        <p className="spx-lotto-play-kicker">{copy.kicker}</p>
        <p className="spx-lotto-play-headline">{copy.headline}</p>
        <p className="spx-lotto-play-thesis">{copy.thesis}</p>
        {lottoRefreshing && !lottoLoading && (
          <p className="spx-lotto-play-footnote">{copy.footnote ?? "Oracle still listening…"}</p>
        )}
      </div>
    );
  }

  const offHours = lottoPanelOffHoursCopy();
  return (
    <div className="spx-lotto-play-block spx-lotto-play-block-empty">
      <p className="spx-lotto-play-kicker">{offHours.kicker}</p>
      <p className="spx-lotto-play-headline">{offHours.headline}</p>
      <p className="spx-lotto-play-thesis">{offHours.thesis}</p>
    </div>
  );
}

export function SpxTradeAlerts({ desk, live, refreshing, sessionActive = true }: Props) {
  const { play, playRefreshing } = useSpxPlay(sessionActive);
  const { lotto, lottoLoading, lottoRefreshing } = useSpxLotto();
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

  const show = play != null && live && sessionActive;

  const panelRefreshing = (refreshing || playRefreshing) && play && play.action !== "SCANNING";

  const showConfirmationPanel =
    Boolean(confirmationLayer) &&
    (play?.action === "SCANNING" ||
      play?.action === "WATCHING" ||
      (!play && playRefreshing));

  return (
    <section
      className={clsx(
        "spx-trade-alerts-panel spx-sniper-panel",
        panelRefreshing && "spx-desk-panel-refreshing"
      )}
    >
      <SpxSniperBackdrop action={play?.action} />
      <div className="spx-sniper-panel-content">
      <header className="spx-trade-alerts-header spx-trade-alerts-header-minimal">
        <span className={clsx("spx-live-pill ml-auto", live ? "spx-live-pill-on" : "spx-live-pill-off")}>
          {live ? "LIVE" : "OFFLINE"}
        </span>
      </header>

      <div className="spx-sniper-panel-body">
      {!show ? (
        <p className="spx-desk-offline-line font-mono py-8 text-center">
          {sessionActive && live
            ? "Loading play engine…"
            : "Session closed · resumes 6:30 AM PT"}
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
                <p
                  className={clsx(
                    "spx-trade-alert-thesis",
                    (play.session_phase === "closed" || isDeskOfflineCopy(play.thesis)) &&
                      "spx-desk-offline-line"
                  )}
                >
                  {play.thesis}
                </p>
                {play.grade && play.action !== "SCANNING" && (
                  <p className="spx-trade-grade-line">
                    Grade {play.grade}
                    {play.open_play ? ` · open ${play.open_play.direction}` : ""}
                    {play.watch?.active ? " · WATCH active" : ""}
                    {play.watch?.promote_ready ? " · promote ready" : ""}
                  </p>
                )}
              </div>
              <div className="spx-trade-alert-score-block text-right shrink-0">
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
                {confirmationLayer.gates.play_idea && (
                  <p className="spx-trade-idea-line">{confirmationLayer.gates.play_idea}</p>
                )}
                {confirmationLayer.gates.warnings.map((w) => (
                  <p key={w} className="spx-trade-confirmation-meta text-amber-300/90">
                    ⚠ {w}
                  </p>
                ))}
                {confirmationLayer.gates.blocks
                  .filter((b) => b !== confirmationLayer.gates.play_idea)
                  .map((b) =>
                    isPlayIdeaLine(b) ? (
                      <p key={b} className="spx-trade-idea-line">
                        {b}
                      </p>
                    ) : (
                      <p key={b} className="spx-trade-block-warn">
                        ⛔ {b}
                      </p>
                    )
                  )}
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
      </div>

      <div className="spx-lotto-dock" aria-label="Lotto engine">
        <LottoPlayBlock
          lotto={lotto}
          lottoLoading={lottoLoading}
          lottoRefreshing={lottoRefreshing}
        />
      </div>
      </div>
    </section>
  );
}
