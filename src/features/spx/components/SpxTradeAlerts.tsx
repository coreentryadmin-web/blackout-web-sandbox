"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import { useSpxPlay } from "@/features/spx/hooks/useSpxPlay";
import { useSpxLotto } from "@/features/spx/hooks/useSpxLotto";
import { useSpxPowerHour } from "@/features/spx/hooks/useSpxPowerHour";
import { useStablePlayConfirmations } from "@/features/spx/hooks/useStablePlayConfirmations";
import { SpxLiveSpotPrice } from "./SpxLiveSpotPrice";
import { SpxTradeAlertsPanels } from "./SpxTradeAlertsPanels";
import { SpxDeskTerminal, type DeskTerminalTab } from "./SpxDeskTerminal";
import { buildTradeAlertPlays } from "@/features/spx/lib/spx-trade-alert-plays";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";

const PLAYBOOK_SHADOW_CACHE_KEY = "spx:playbook-shadow:last";

function readCachedPlaybookShadow(): PlaybookShadowPanel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PLAYBOOK_SHADOW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaybookShadowPanel;
    if (!parsed?.verdicts?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedPlaybookShadow(panel: PlaybookShadowPanel) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PLAYBOOK_SHADOW_CACHE_KEY, JSON.stringify(panel));
  } catch {
    /* ignore quota */
  }
}

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  refreshing?: boolean;
  sessionActive?: boolean;
  /** When true (iOS non-plays tab), hide both plays + terminal columns. */
  iosHidden?: boolean;
};

type HistoryRow = SpxPlayPayload & { id: string };

function playDeskAlert(type: "buy" | "watch") {
  try {
    const AudioCtx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === "buy") {
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 880;
      gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 0.55);
    } else {
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch {
    // Audio API unavailable
  }
}

function playId(p: SpxPlayPayload): string {
  return `${p.action}|${p.direction}|${p.confidence}|${Math.round(p.score)}|${p.headline}`;
}

function hasOpenPlay(play: SpxPlayPayload): boolean {
  return Boolean(
    play.open_play &&
      (play.phase === "OPEN" ||
        play.action === "BUY" ||
        play.action === "HOLD" ||
        play.action === "TRIM")
  );
}

function hasWatchPlay(play: SpxPlayPayload): boolean {
  return Boolean(play.watch?.active || play.action === "WATCHING" || play.phase === "WATCHING");
}

export function SpxTradeAlerts({ desk, live, sessionActive = true, iosHidden = false }: Props) {
  const { play } = useSpxPlay(sessionActive);
  const { lotto } = useSpxLotto();
  const { powerHour } = useSpxPowerHour();
  const confirmationLayer = useStablePlayConfirmations(play);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [pinnedStructure, setPinnedStructure] = useState<SpxPlayPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [terminalTab, setTerminalTab] = useState<DeskTerminalTab>("playbook");
  const lastIdRef = useRef<string>("");
  const prevActionRef = useRef<string | null>(null);

  useEffect(() => {
    const action = play?.action;
    const prev = prevActionRef.current;
    prevActionRef.current = action ?? null;

    if (!action || !prev) return;
    if (action === "BUY" && prev !== "BUY" && play?.signal_committed) {
      playDeskAlert("buy");
    } else if (action === "WATCHING" && prev === "SCANNING") {
      playDeskAlert("watch");
    }
  }, [play?.action, play?.signal_committed]);

  useEffect(() => {
    if (!play || play.action === "SCANNING") return;
    const id = playId(play);
    if (id === lastIdRef.current) return;
    lastIdRef.current = id;
    setHistory((prev) => [{ ...play, id: `${id}|${Date.now()}` }, ...prev].slice(0, 24));
  }, [play]);

  useEffect(() => {
    if (!play) return;
    if (play.action === "SELL") {
      setPinnedStructure(null);
      return;
    }
    if (play.open_play && (play.action === "HOLD" || play.action === "TRIM" || play.action === "BUY")) {
      setPinnedStructure(play);
    }
  }, [play]);

  const sessionLive = Boolean(live && sessionActive);

  // Persist last non-empty shadow panel so AH / refresh can still show Phase-2 ARM state.
  const livePlaybook = play?.playbook_shadow ?? null;
  useEffect(() => {
    if (livePlaybook?.verdicts?.length) writeCachedPlaybookShadow(livePlaybook);
  }, [livePlaybook]);
  const [cachedPlaybook] = useState<PlaybookShadowPanel | null>(() => readCachedPlaybookShadow());
  const playbookPanel = livePlaybook?.verdicts?.length
    ? livePlaybook
    : !sessionLive
      ? cachedPlaybook
      : livePlaybook;

  const structureOpen = Boolean(
    sessionLive && (pinnedStructure ? hasOpenPlay(pinnedStructure) : play && hasOpenPlay(play))
  );
  const structureWatch = Boolean(
    sessionLive && play && hasWatchPlay(play) && !structureOpen && !pinnedStructure?.open_play
  );

  const tradePanels = useMemo(
    () =>
      buildTradeAlertPlays({
        play,
        lotto,
        powerHour,
        history,
        structureOpen,
        structureWatch,
        sessionLive,
        pinnedStructurePlay: pinnedStructure,
      }),
    [play, lotto, powerHour, history, structureOpen, structureWatch, sessionLive, pinnedStructure]
  );

  const allPlays = useMemo(
    () => [...tradePanels.open, ...tradePanels.watch, ...tradePanels.closed],
    [tradePanels]
  );

  useEffect(() => {
    if (selectedId && allPlays.some((p) => p.id === selectedId)) return;
    setSelectedId(tradePanels.open[0]?.id ?? tradePanels.watch[0]?.id ?? tradePanels.closed[0]?.id ?? null);
  }, [selectedId, allPlays, tradePanels.open, tradePanels.watch, tradePanels.closed]);

  const historyThesis = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of history) m.set(row.id, row.thesis);
    if (play?.action === "SELL") m.set("structure-sell", play.thesis);
    if (lotto?.phase === "SELL" || lotto?.phase === "INVALID") m.set("lotto-closed", lotto.thesis);
    if (powerHour?.phase === "SELL") m.set("power-closed", powerHour.thesis ?? "");
    return m;
  }, [history, play, lotto, powerHour]);

  const displayPlay = pinnedStructure ?? play;
  const selected = allPlays.find((p) => p.id === selectedId) ?? null;
  const closedThesis = selected ? historyThesis.get(selected.id) : undefined;

  const selectPlay = (id: string) => {
    setSelectedId(id);
    setTerminalTab("play");
  };

  return (
    <>
      <section
        className={clsx(
          "spx-trade-alerts-panel spx-sniper-panel spx-trade-alerts-v3 spx-sniper-plays-col",
          iosHidden && "ios-native-panel-hidden"
        )}
      >
        <div className="spx-sniper-panel-content">
          <header className="spx-trade-alerts-header">
            <SpxLiveSpotPrice
              desk={desk}
              live={live}
              size="panel"
              className="spx-play-engine-spot spx-trade-alerts-spot hide-in-ios-app"
            />
            <div className="min-w-0 flex-1">
              <h3 className="spx-trade-alerts-title">Trade Alerts</h3>
              <p className="spx-trade-alerts-subtitle">
                Structure · Lotto · Power hour
                {!sessionLive && (
                  <span className="spx-trade-alerts-subtitle-muted"> · session wrapped</span>
                )}
              </p>
            </div>
          </header>

          <div className="spx-sniper-panel-body spx-trade-alerts-stack spx-trade-alerts-stack--plays">
            {!sessionLive && (
              <div className="spx-desk-session-strip spx-desk-session-strip--compact" role="status">
                <span className="spx-desk-session-strip-dot" aria-hidden />
                <p className="spx-desk-session-strip-body">
                  {live ? "0DTE window closed" : "After hours"} — wrapped plays · re-arms{" "}
                  <span className="spx-desk-closed-time">6:30 AM PT</span>
                </p>
              </div>
            )}

            <SpxTradeAlertsPanels
              panels={tradePanels}
              play={displayPlay}
              lotto={lotto}
              powerHour={powerHour}
              selectedId={selectedId}
              onSelectPlay={selectPlay}
            />
            <p className="spx-trade-educational-note spx-trade-educational-note--plays">
              Educational. Not advice. Every trade is your own decision.
            </p>
          </div>
        </div>
      </section>

      <div
        className={clsx("spx-sniper-terminal-col", iosHidden && "ios-native-panel-hidden")}
      >
        <SpxDeskTerminal
          activeTab={terminalTab}
          onTabChange={setTerminalTab}
          selected={selected}
          play={displayPlay}
          lotto={lotto}
          powerHour={powerHour}
          playbookPanel={playbookPanel}
          desk={desk}
          confirmationLayer={confirmationLayer}
          closedThesis={closedThesis}
          sessionLive={sessionLive}
          live={sessionLive}
          asOf={play?.as_of ?? desk?.polled_at ?? null}
        />
      </div>
    </>
  );
}
