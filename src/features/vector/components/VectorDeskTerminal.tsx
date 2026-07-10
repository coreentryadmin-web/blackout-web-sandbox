"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetchSpxPlay } from "@/lib/api";
import { PlayTerminalWindow } from "@/components/terminal/PlayTerminalWindow";
import { buildPlaybookTerminalLines } from "@/features/spx/lib/spx-play-terminal-lines";
import { buildVectorTerminalLines } from "@/features/vector/lib/vector-terminal-lines";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";

type Props = {
  ticker: string;
  lens: VectorWallLens;
  wallEvents: VectorWallEvent[];
  liveSession: boolean;
  streamUpdatedAt?: number | null;
};

/**
 * Vector side terminal — SPX shows full playbook monitor; other tickers show structure events.
 */
export function VectorDeskTerminal({ ticker, lens, wallEvents, liveSession, streamUpdatedAt }: Props) {
  const normalized = normalizeVectorTicker(ticker);
  const isSpx = normalized === "SPX";

  const { data: spxPlay } = useSWR(isSpx && liveSession ? "vector-spx-playbook" : null, fetchSpxPlay, {
    refreshInterval: liveSession ? 3_000 : 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const lines = useMemo(() => {
    if (isSpx && spxPlay?.playbook_shadow) {
      const pb = buildPlaybookTerminalLines(spxPlay.playbook_shadow, liveSession);
      const header: typeof pb = [
        {
          icon: "section",
          tone: "accent",
          text: "VECTOR · SPX — linked playbook monitor",
        },
      ];
      return [...header, ...pb.slice(1)];
    }
    return buildVectorTerminalLines(normalized, lens, wallEvents, liveSession);
  }, [isSpx, spxPlay?.playbook_shadow, liveSession, normalized, lens, wallEvents]);

  const cmd = isSpx ? "playbook --spx --vector-desk" : `vector --ticker ${normalized} --structure`;

  return (
    <PlayTerminalWindow
      title={`blackout — ${normalized} terminal`}
      host="blackout-vector"
      cmd={cmd}
      lines={lines}
      live={liveSession}
      asOf={streamUpdatedAt ? new Date(streamUpdatedAt).toISOString() : spxPlay?.as_of ?? null}
      ariaLabel={`Vector terminal for ${normalized}`}
      className="vector-desk-terminal"
    />
  );
}
