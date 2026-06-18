"use client";

import { clsx } from "clsx";
import { AGENT_MODES } from "@/lib/nighthawk/agent-config";
import type { HuntMode } from "@/lib/nighthawk/types";

type AgentSidebarProps = {
  activeMode: HuntMode | null;
  onSelect: (mode: HuntMode) => void;
};

const ACCENT_CLASS = {
  cyan: "nighthawk-agent-card-cyan",
  bear: "nighthawk-agent-card-bear",
  purple: "nighthawk-agent-card-purple",
} as const;

export function AgentSidebar({ activeMode, onSelect }: AgentSidebarProps) {
  return (
    <aside className="nighthawk-agent-sidebar">
      <header className="nighthawk-agent-sidebar-header">
        <p className="nighthawk-agent-kicker">Hunt modes</p>
        <h2 className="nighthawk-agent-title">Power up an agent</h2>
        <p className="nighthawk-agent-sub">
          Each mode runs its own ruleset — flow, technicals, and contract logic tuned to the horizon.
        </p>
      </header>

      <div className="nighthawk-agent-list">
        {AGENT_MODES.map((agent) => (
          <button
            key={agent.mode}
            type="button"
            onClick={() => onSelect(agent.mode)}
            className={clsx(
              "nighthawk-agent-card",
              ACCENT_CLASS[agent.accent],
              activeMode === agent.mode && "nighthawk-agent-card-active"
            )}
          >
            <div className="nighthawk-agent-card-top">
              <span className="nighthawk-agent-card-icon" aria-hidden>
                {agent.mode === "day" ? "⚡" : agent.mode === "swing" ? "◎" : "◈"}
              </span>
              <span className="nighthawk-agent-card-power">Power</span>
            </div>
            <p className="nighthawk-agent-card-name">{agent.title}</p>
            <p className="nighthawk-agent-card-tag">{agent.tagline}</p>
          </button>
        ))}
      </div>
    </aside>
  );
}
