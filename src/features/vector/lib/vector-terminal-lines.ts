import type { PlayTerminalLine } from "@/features/spx/lib/spx-play-terminal-lines";
import type { VectorWallEvent, VectorWallEventKind } from "@/features/vector/lib/vector-wall-events";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { formatReplayClock } from "@/features/vector/lib/vector-replay";

const KIND_ICON: Record<VectorWallEventKind, PlayTerminalLine["icon"]> = {
  call_wall_shift: "gamma",
  put_wall_shift: "gamma",
  flip_shift: "level",
  spot_crossed_flip: "pulse",
  spot_broke_call: "level",
  spot_broke_put: "level",
};

const KIND_TONE: Record<VectorWallEventKind, PlayTerminalLine["tone"]> = {
  call_wall_shift: "accent",
  put_wall_shift: "accent",
  flip_shift: "accent",
  spot_crossed_flip: "warn",
  spot_broke_call: "bear",
  spot_broke_put: "bear",
};

export function buildVectorTerminalLines(
  ticker: string,
  lens: VectorWallLens,
  events: VectorWallEvent[],
  sessionLive: boolean
): PlayTerminalLine[] {
  const lines: PlayTerminalLine[] = [
    {
      icon: "section",
      tone: "accent",
      text: `VECTOR · ${ticker} · ${lens.toUpperCase()} structure`,
    },
    {
      icon: "dim",
      tone: "dim",
      text: sessionLive ? "Live wall / flip events for selected ticker" : "Session close — replay structure feed",
      indent: 1,
    },
  ];

  const visible = events.filter((e) => e.lens === lens).slice(-24);
  if (!visible.length) {
    lines.push({
      icon: "dim",
      tone: "dim",
      text: `No ${lens.toUpperCase()} structure shifts yet — chart polling…`,
      indent: 1,
    });
    return lines;
  }

  for (const event of visible) {
    lines.push({
      icon: KIND_ICON[event.kind],
      tone: event.severity === "warn" ? "warn" : KIND_TONE[event.kind],
      text: `${formatReplayClock(event.time)} · ${event.message}`,
      indent: 1,
    });
  }

  return lines;
}
