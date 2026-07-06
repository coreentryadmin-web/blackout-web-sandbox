"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { fetchNightHawkEdition, fetchNightHawkPlayStatus, fetchNightHawkRecord } from "@/lib/api";
import type { PlaybookPlay, PlayMorningStatus } from "@/lib/nighthawk/types";
import { NightsWatchPanel } from "@/components/nights-watch/NightsWatchPanel";
import { PlayDetailModal } from "@/components/nighthawk/PlayDetailModal";
import { PlaybookBoard } from "@/components/nighthawk/PlaybookBoard";
import { useState } from "react";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";

export function NightHawkFeed() {
  const [selectedPlay, setSelectedPlay] = useState<PlaybookPlay | null>(null);
  const nativeShell = useIosNativeShell();
  const [iosView, setIosView] = useState<"playbook" | "watch">("playbook");

  const { data: edition, error: editionError, isLoading: editionLoading } = useSWR("nighthawk-edition", fetchNightHawkEdition, {
    refreshInterval: 120_000,
  });

  const editionFor = edition?.edition_for ?? undefined;
  const { data: playStatus } = useSWR(
    editionFor ? ["nighthawk-play-status", editionFor] : null,
    () => fetchNightHawkPlayStatus(editionFor),
    { refreshInterval: 60_000 }
  );

  const { data: record, isLoading: recordLoading } = useSWR("nighthawk-record", () => fetchNightHawkRecord(30), {
    refreshInterval: 300_000,
  });

  const confirmByTicker = new Map<string, PlayMorningStatus>();
  if (playStatus?.available && playStatus.plays) {
    for (const p of playStatus.plays) {
      confirmByTicker.set(p.ticker.toUpperCase(), p);
    }
  }

  return (
    <div className="nighthawk-content-canvas">
      {nativeShell && (
        <IosNativeSegment
          value={iosView}
          onChange={setIosView}
          accent="#ff2d55"
          aria-label="Night Hawk view"
          className="ios-native-desk-segment mb-2"
          segments={[
            { id: "playbook", label: "Playbook" },
            { id: "watch", label: "Night's Watch" },
          ]}
        />
      )}
      <div className="nighthawk-layout">
        <div
          key={nativeShell ? iosView : "playbook"}
          className={clsx(
            nativeShell && iosView !== "playbook" && "ios-native-panel-hidden",
            nativeShell && iosView === "playbook" && "ios-native-panel-visible"
          )}
        >
          <PlaybookBoard
            edition={edition}
            loading={editionLoading}
            editionError={
              editionError
                ? "Edition failed to load — auto-retrying every 2 minutes. Check connection or refresh."
                : undefined
            }
            onPlaySelect={setSelectedPlay}
            confirmByTicker={confirmByTicker}
            playStatusAvailable={Boolean(playStatus?.available)}
            record={record}
            recordLoading={recordLoading}
          />
        </div>
        <div
          key={nativeShell ? iosView : "watch"}
          className={clsx(
            nativeShell && iosView !== "watch" && "ios-native-panel-hidden",
            nativeShell && iosView === "watch" && "ios-native-panel-visible"
          )}
        >
          <NightsWatchPanel />
        </div>
      </div>

      <PlayDetailModal
        play={selectedPlay}
        editionFor={edition?.edition_for ?? null}
        onClose={() => setSelectedPlay(null)}
      />
    </div>
  );
}
