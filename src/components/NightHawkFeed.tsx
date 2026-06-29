"use client";

import useSWR from "swr";
import { fetchNightHawkEdition, fetchNightHawkPlayStatus, fetchNightHawkRecord } from "@/lib/api";
import type { PlaybookPlay, PlayMorningStatus } from "@/lib/nighthawk/types";
import { NightsWatchPanel } from "@/components/nights-watch/NightsWatchPanel";
import { PlayDetailModal } from "@/components/nighthawk/PlayDetailModal";
import { PlaybookBoard } from "@/components/nighthawk/PlaybookBoard";
import { useState } from "react";

export function NightHawkFeed() {
  const [selectedPlay, setSelectedPlay] = useState<PlaybookPlay | null>(null);

  const { data: edition, isLoading: editionLoading } = useSWR("nighthawk-edition", fetchNightHawkEdition, {
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
      <div className="nighthawk-layout">
        <PlaybookBoard
          edition={edition}
          loading={editionLoading}
          onPlaySelect={setSelectedPlay}
          confirmByTicker={confirmByTicker}
          playStatusAvailable={Boolean(playStatus?.available)}
          record={record}
          recordLoading={recordLoading}
        />
        <NightsWatchPanel />
      </div>

      <PlayDetailModal
        play={selectedPlay}
        editionFor={edition?.edition_for ?? null}
        onClose={() => setSelectedPlay(null)}
      />
    </div>
  );
}
