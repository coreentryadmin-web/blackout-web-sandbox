"use client";

import { useMemo } from "react";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import { buildPlaybookTerminalLines } from "@/features/spx/lib/spx-play-terminal-lines";
import { PlayTerminalWindow } from "@/components/terminal/PlayTerminalWindow";

type Props = {
  playbookPanel: PlaybookShadowPanel | null | undefined;
  sessionLive?: boolean;
  live?: boolean;
  asOf?: string | null;
};

/** SPX Slayer terminal — playbook catalog + live verdicts only (no walls / 0DTE intel / play tab). */
export function SpxDeskTerminal({ playbookPanel, sessionLive = true, live, asOf }: Props) {
  const lines = useMemo(
    () => buildPlaybookTerminalLines(playbookPanel, sessionLive),
    [playbookPanel, sessionLive]
  );

  return (
    <PlayTerminalWindow
      title="blackout — playbook monitor"
      host="blackout-desk"
      cmd="playbook --all --watch"
      lines={lines}
      live={live ?? sessionLive}
      asOf={asOf}
      ariaLabel="SPX playbook terminal"
    />
  );
}
