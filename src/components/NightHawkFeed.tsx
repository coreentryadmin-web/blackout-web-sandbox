"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetchNightHawkEdition } from "@/lib/api";
import type { PlaybookPlay } from "@/lib/nighthawk/types";
import { NightsWatchPanel } from "@/components/nights-watch/NightsWatchPanel";
import { PlayDetailModal } from "@/components/nighthawk/PlayDetailModal";
import { PlaybookBoard } from "@/components/nighthawk/PlaybookBoard";

export function NightHawkFeed() {
  const [selectedPlay, setSelectedPlay] = useState<PlaybookPlay | null>(null);

  const { data: edition, isLoading } = useSWR("nighthawk-edition", fetchNightHawkEdition, {
    refreshInterval: 120_000,
  });

  return (
    <div className="nighthawk-content-canvas">
      <div className="nighthawk-layout">
        <PlaybookBoard
          edition={edition}
          loading={isLoading}
          onPlaySelect={setSelectedPlay}
        />
        {/* Phase 4: the right column is now the Night's Watch positions manager.
            The AgentSidebar ("Arm an Agent" / Hunt Modes) component file is kept
            in place but no longer rendered here. */}
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
