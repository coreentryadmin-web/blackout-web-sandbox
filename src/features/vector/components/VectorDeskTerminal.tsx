"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetchSpxPlay } from "@/lib/api";
import { PlayTerminalWindow } from "@/components/terminal/PlayTerminalWindow";
import { buildPlaybookTerminalLines } from "@/features/spx/lib/spx-play-terminal-lines";
import { buildVectorTerminalLines } from "@/features/vector/lib/vector-terminal-lines";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import type { WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import type { PlayTerminalLine } from "@/features/spx/lib/spx-play-terminal-lines";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";

type Props = {
  ticker: string;
  lens: VectorWallLens;
  wallEvents: VectorWallEvent[];
  liveSession: boolean;
  streamUpdatedAt?: number | null;
  proximity?: WallProximity | null;
};

/**
 * Vector side terminal — SPX shows full playbook monitor; other tickers show structure events.
 */
export function VectorDeskTerminal({
  ticker,
  lens,
  wallEvents,
  liveSession,
  streamUpdatedAt,
  proximity,
}: Props) {
  const normalized = normalizeVectorTicker(ticker);
  const isSpx = normalized === "SPX";

  const { data: spxPlay, error: spxPlayError } = useSWR(
    isSpx && liveSession ? "vector-spx-playbook" : null,
    fetchSpxPlay,
    {
      refreshInterval: liveSession ? 3_000 : 0,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const lines = useMemo(() => {
    let base: PlayTerminalLine[];
    // A persistently failing playbook fetch must not silently degrade to the
    // structure-events view looking like "no playbook activity" — surface it.
    if (isSpx && liveSession && spxPlayError && !spxPlay) {
      base = [
        { icon: "section", tone: "accent", text: "VECTOR · SPX — linked playbook monitor" },
        { icon: "no", tone: "warn", text: "playbook feed unavailable — retrying", indent: 1 },
        ...buildVectorTerminalLines(normalized, lens, wallEvents, liveSession).slice(1),
      ];
    } else if (isSpx && spxPlay?.playbook_shadow) {
      const pb = buildPlaybookTerminalLines(spxPlay.playbook_shadow, liveSession);
      base = [
        { icon: "section", tone: "accent", text: "VECTOR · SPX — linked playbook monitor" },
        ...pb.slice(1),
      ];
    } else {
      base = buildVectorTerminalLines(normalized, lens, wallEvents, liveSession);
    }
    // Inject the live wall-proximity pulse right under the header — the "what
    // matters right now" line. Absent when spot is in open space (no nearby level).
    if (proximity) {
      const pulse: PlayTerminalLine = {
        icon: "pulse",
        tone: proximity.nearness === "at" ? "warn" : "accent",
        text: proximity.callout,
        indent: 1,
      };
      return [base[0]!, pulse, ...base.slice(1)];
    }
    return base;
  }, [isSpx, spxPlay, spxPlayError, liveSession, normalized, lens, wallEvents, proximity]);

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
