"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetchNightHawkEdition } from "@/lib/api";
import type { HuntMode, PlaybookPlay } from "@/lib/nighthawk/types";
import { AgentPowerModal } from "@/components/nighthawk/AgentPowerModal";
import { AgentSidebar } from "@/components/nighthawk/AgentSidebar";
import { DayTradeAgentWorkspace } from "@/components/nighthawk/DayTradeAgentWorkspace";
import { PlayDetailModal } from "@/components/nighthawk/PlayDetailModal";
import { PlaybookBoard } from "@/components/nighthawk/PlaybookBoard";

export function NightHawkFeed() {
  const [agentMode, setAgentMode] = useState<HuntMode | null>(null);
  const [dayWorkspaceOpen, setDayWorkspaceOpen] = useState(false);
  const [selectedPlay, setSelectedPlay] = useState<PlaybookPlay | null>(null);

  const { data: edition, isLoading } = useSWR("nighthawk-edition", fetchNightHawkEdition, {
    refreshInterval: 120_000,
  });

  function handleAgentSelect(mode: HuntMode) {
    if (mode === "day") {
      setDayWorkspaceOpen(true);
      setAgentMode(null);
      return;
    }
    setAgentMode(mode);
  }

  return (
    <div className="nighthawk-content-canvas">
      <div className="nighthawk-layout">
        <PlaybookBoard
          edition={edition}
          loading={isLoading}
          onPlaySelect={setSelectedPlay}
        />
        <AgentSidebar activeMode={dayWorkspaceOpen ? "day" : agentMode} onSelect={handleAgentSelect} />
      </div>

      <DayTradeAgentWorkspace open={dayWorkspaceOpen} onClose={() => setDayWorkspaceOpen(false)} />
      <AgentPowerModal mode={agentMode} onClose={() => setAgentMode(null)} />
      <PlayDetailModal
        play={selectedPlay}
        editionFor={edition?.edition_for ?? null}
        onClose={() => setSelectedPlay(null)}
      />
    </div>
  );
}
