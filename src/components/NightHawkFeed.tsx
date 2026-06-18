"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetchNightHawkEdition } from "@/lib/api";
import type { HuntMode } from "@/lib/nighthawk/types";
import { AgentPowerModal } from "@/components/nighthawk/AgentPowerModal";
import { AgentSidebar } from "@/components/nighthawk/AgentSidebar";
import { PlaybookBoard } from "@/components/nighthawk/PlaybookBoard";

export function NightHawkFeed() {
  const [agentMode, setAgentMode] = useState<HuntMode | null>(null);

  const { data: edition, isLoading } = useSWR("nighthawk-edition", fetchNightHawkEdition, {
    refreshInterval: 120_000,
  });

  return (
    <div className="nighthawk-content-canvas">
      <div className="nighthawk-layout">
        <PlaybookBoard edition={edition} loading={isLoading} />
        <AgentSidebar activeMode={agentMode} onSelect={setAgentMode} />
      </div>

      <AgentPowerModal mode={agentMode} onClose={() => setAgentMode(null)} />
    </div>
  );
}
