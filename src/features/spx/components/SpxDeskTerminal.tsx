"use client";

import { useMemo } from "react";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { PlayConfirmationLayer } from "@/features/spx/hooks/useStablePlayConfirmations";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import type { TradeAlertPlay } from "@/features/spx/lib/spx-trade-alert-plays";
import {
  buildPlayTerminalLines,
  buildPlaybookTerminalLines,
  playTerminalTitle,
} from "@/features/spx/lib/spx-play-terminal-lines";
import { PlayTerminalWindow } from "@/components/terminal/PlayTerminalWindow";

export type DeskTerminalTab = "playbook" | "play";

type Props = {
  activeTab: DeskTerminalTab;
  onTabChange: (tab: DeskTerminalTab) => void;
  selected: TradeAlertPlay | null;
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  playbookPanel: PlaybookShadowPanel | null | undefined;
  desk?: SpxDeskPayload;
  confirmationLayer: PlayConfirmationLayer | null;
  closedThesis?: string;
  sessionLive?: boolean;
  live?: boolean;
  asOf?: string | null;
};

/** SPX desk terminal — Playbook monitor + selected-play trade guide (no walls / 0DTE intel). */
export function SpxDeskTerminal({
  activeTab,
  onTabChange,
  selected,
  play,
  lotto,
  powerHour,
  playbookPanel,
  desk,
  confirmationLayer,
  closedThesis,
  sessionLive = true,
  live,
  asOf,
}: Props) {
  const playbookLines = useMemo(
    () => buildPlaybookTerminalLines(playbookPanel, sessionLive),
    [playbookPanel, sessionLive]
  );

  const playLines = useMemo(
    () =>
      buildPlayTerminalLines({
        selected,
        play,
        lotto,
        powerHour,
        desk,
        confirmationLayer,
        closedThesis,
      }),
    [selected, play, lotto, powerHour, desk, confirmationLayer, closedThesis]
  );

  const lines = activeTab === "playbook" ? playbookLines : playLines;
  const cmd = activeTab === "playbook" ? "playbook --all --watch" : "play --follow --manage";
  const title =
    activeTab === "playbook" ? "blackout — playbook monitor" : playTerminalTitle(selected);
  const playTabLabel = selected ? selected.chip.label : "Play";

  return (
    <PlayTerminalWindow
      title={title}
      host="blackout-desk"
      cmd={cmd}
      lines={lines}
      live={live ?? sessionLive}
      asOf={asOf}
      ariaLabel="SPX desk terminal"
      tabs={[
        {
          id: "playbook",
          label: "Playbook",
          selected: activeTab === "playbook",
          onSelect: () => onTabChange("playbook"),
        },
        {
          id: "play",
          label: playTabLabel,
          selected: activeTab === "play",
          onSelect: () => onTabChange("play"),
        },
      ]}
      tabPanelLabel={activeTab === "playbook" ? "Playbook monitor" : "Selected play trade guide"}
    />
  );
}
