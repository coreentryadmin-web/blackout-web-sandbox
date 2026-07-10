"use client";

import { useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { PlayTerminalIcon, PlayTerminalLine } from "@/features/spx/lib/spx-play-terminal-lines";

const ICON_GLYPH: Record<PlayTerminalIcon, string> = {
  prompt: "❯",
  section: "◆",
  ok: "✓",
  no: "✕",
  vwap: "▲",
  flow: "◎",
  gamma: "⬡",
  level: "▸",
  news: "▪",
  trim: "✂",
  sell: "⏹",
  watch: "◉",
  dim: "·",
  pulse: "●",
};

function TerminalLine({ line }: { line: PlayTerminalLine }) {
  const indentPx = (line.indent ?? 0) * 12;
  return (
    <div
      className={clsx("spx-play-terminal-line", `spx-play-terminal-line--${line.tone}`)}
      style={indentPx ? { paddingLeft: indentPx } : undefined}
    >
      <span className={clsx("spx-play-terminal-glyph", `spx-play-terminal-glyph--${line.icon}`)} aria-hidden>
        {ICON_GLYPH[line.icon]}
      </span>
      <span className="spx-play-terminal-text">{line.text}</span>
    </div>
  );
}

export type PlayTerminalWindowProps = {
  title: string;
  host?: string;
  cmd: string;
  lines: PlayTerminalLine[];
  live?: boolean;
  asOf?: string | null;
  ariaLabel?: string;
  className?: string;
};

/** Shared macOS-style terminal chrome (SPX desk + Vector side panel). */
export function PlayTerminalWindow({
  title,
  host = "blackout-desk",
  cmd,
  lines,
  live,
  asOf,
  ariaLabel = "Desk terminal",
  className,
}: PlayTerminalWindowProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, asOf]);

  const timeLabel = asOf
    ? new Date(asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className={clsx("spx-play-terminal-window", className)} role="region" aria-label={ariaLabel}>
      <div className="spx-play-terminal-titlebar">
        <div className="spx-play-terminal-traffic" aria-hidden>
          <span className="spx-play-terminal-dot spx-play-terminal-dot--close" />
          <span className="spx-play-terminal-dot spx-play-terminal-dot--min" />
          <span className="spx-play-terminal-dot spx-play-terminal-dot--max" />
        </div>
        <p className="spx-play-terminal-title">{title}</p>
        <div className="spx-play-terminal-titlebar-meta">
          {live && <span className="spx-play-terminal-live">LIVE</span>}
          {timeLabel && <span className="spx-play-terminal-clock">{timeLabel}</span>}
        </div>
      </div>

      <div ref={scrollRef} className="spx-play-terminal-body" role="log" aria-live="polite">
        <div className="spx-play-terminal-prompt-line">
          <span className="spx-play-terminal-user">member</span>
          <span className="spx-play-terminal-at">@</span>
          <span className="spx-play-terminal-host">{host}</span>
          <span className="spx-play-terminal-path"> ~ </span>
          <span className="spx-play-terminal-cmd">{cmd}</span>
        </div>
        {lines.map((line, i) => (
          <TerminalLine key={`${line.icon}-${line.text}-${i}`} line={line} />
        ))}
        <div className="spx-play-terminal-cursor-line" aria-hidden />
      </div>
    </div>
  );
}
