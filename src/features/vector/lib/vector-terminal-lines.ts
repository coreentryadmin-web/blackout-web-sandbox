import type { PlayTerminalLine } from "@/features/spx/lib/spx-play-terminal-lines";
import type { VectorWallEvent, VectorWallEventKind } from "@/features/vector/lib/vector-wall-events";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { formatReplayClock } from "@/features/vector/lib/vector-replay";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";

/**
 * Render the synthesized PLAY as the bold TOP block of the desk terminal — the hero read that sits
 * above the live "what's on the chart" narration (CONFLUENCE / TECHNICALS / EXPECTED MOVE / ALERTS /
 * structure). Pure string→lines mapping so it's unit-testable and the terminal component stays thin.
 *
 * Emphasis is grade-keyed (A = bull/green confidence, B = accent, C = muted) so a member reads
 * conviction at a glance without parsing the number. The headline is always the first starred item;
 * the REMAINING starred items become an explicit "WATCH NOW" set marked with ★, which is the
 * "watch this second" list (imminent flip cross, a wall under test, a top confluence stack, the BIE
 * evidence line). Returns [] for a null play so the terminal simply omits the block — never a filler.
 */
export function buildVectorPlayLines(play: VectorPlay | null): PlayTerminalLine[] {
  if (!play) return [];
  const gradeTone: PlayTerminalLine["tone"] =
    play.grade === "A" ? "bull" : play.grade === "B" ? "accent" : "neutral";
  const styleLabel = play.style.toUpperCase();

  const lines: PlayTerminalLine[] = [
    // Header carries the style (SCALP/SWING/POSITION), grade, and conviction — the at-a-glance verdict.
    {
      icon: "section",
      tone: "accent",
      text: `PLAY · ${styleLabel} · Grade ${play.grade} · conviction ${play.conviction}/100`,
    },
    // Headline is the always-starred hero line, toned by grade.
    { icon: "pulse", tone: gradeTone, text: `★ ${play.headline}`, indent: 1 },
  ];

  if (play.thesis) {
    lines.push({ icon: "prompt", tone: "neutral", text: play.thesis, indent: 1 });
  }
  if (play.entryZone) {
    lines.push({ icon: "level", tone: "accent", text: `Entry — ${play.entryZone}`, indent: 1 });
  }
  if (play.targets.length) {
    lines.push({ icon: "level", tone: "bull", text: `Targets — ${play.targets.join(" → ")}`, indent: 1 });
  }
  if (play.invalidation) {
    lines.push({ icon: "sell", tone: "warn", text: `Invalidation — ${play.invalidation}`, indent: 1 });
  }

  // The remaining starred items (starred[0] is the headline, already shown) are the "watch NOW" set.
  const watch = play.starred.slice(1);
  if (watch.length) {
    lines.push({ icon: "section", tone: "accent", text: "WATCH NOW", indent: 1 });
    for (const w of watch) {
      lines.push({ icon: "watch", tone: "accent", text: `★ ${w}`, indent: 2 });
    }
  }

  return lines;
}

const KIND_ICON: Record<VectorWallEventKind, PlayTerminalLine["icon"]> = {
  call_wall_shift: "gamma",
  put_wall_shift: "gamma",
  flip_shift: "level",
  spot_crossed_flip: "pulse",
  spot_broke_call: "level",
  spot_broke_put: "level",
  call_wall_building: "gamma",
  put_wall_building: "gamma",
  call_wall_fading: "gamma",
  put_wall_fading: "gamma",
  call_wall_new: "flow",
  put_wall_new: "flow",
  call_wall_gone: "no",
  put_wall_gone: "no",
};

const KIND_TONE: Record<VectorWallEventKind, PlayTerminalLine["tone"]> = {
  call_wall_shift: "accent",
  put_wall_shift: "accent",
  flip_shift: "accent",
  spot_crossed_flip: "warn",
  spot_broke_call: "bear",
  spot_broke_put: "bear",
  // Building resistance/support firming = bull-ish structure; fading/dissolving = weakening.
  call_wall_building: "bull",
  put_wall_building: "bull",
  call_wall_fading: "warn",
  put_wall_fading: "warn",
  call_wall_new: "accent",
  put_wall_new: "accent",
  call_wall_gone: "warn",
  put_wall_gone: "warn",
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
