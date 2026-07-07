"use client";

import clsx from "clsx";

type Props = {
  replayMode: boolean;
  playing: boolean;
  canReplay: boolean;
  cursorIndex: number;
  stepCount: number;
  clockLabel: string;
  speed: number;
  loop: boolean;
  onToggleReplay: () => void;
  onTogglePlay: () => void;
  onScrub: (index: number) => void;
  onSpeed: (speed: number) => void;
  onStep: (delta: number) => void;
  onJumpOpen: () => void;
  onJumpClose: () => void;
  onToggleLoop: () => void;
};

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

const iconBtn =
  "font-mono text-[10px] rounded-lg border border-white/15 px-2 py-1 text-sky-300 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-30";

/** Session replay — compact transport in toolbar + expanded scrub row when active. */
export function VectorReplayControls({
  replayMode,
  playing,
  canReplay,
  cursorIndex,
  stepCount,
  clockLabel,
  speed,
  loop,
  onToggleReplay,
  onTogglePlay,
  onScrub,
  onSpeed,
  onStep,
  onJumpOpen,
  onJumpClose,
  onToggleLoop,
}: Props) {
  const maxIndex = Math.max(0, stepCount - 1);

  return (
    <div className="vector-replay-controls flex min-w-0 flex-col gap-1.5">
      <div className="vector-replay-bar flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleReplay}
          disabled={!canReplay && !replayMode}
          data-testid="vector-replay-toggle"
          aria-label={replayMode ? "Exit replay" : "Replay session"}
          title={replayMode ? "Exit replay (Esc)" : "Replay session"}
          className={clsx(
            "font-mono text-[10px] font-semibold rounded-lg border px-2.5 py-1.5 transition-all",
            replayMode
              ? "border-gold/70 text-gold bg-gold/15"
              : "border-[rgba(0,230,118,0.3)] text-[#00e676] disabled:cursor-not-allowed disabled:opacity-30"
          )}
        >
          {replayMode ? "■ Live" : "▶ Replay"}
        </button>

        {replayMode && stepCount > 0 && (
          <>
            <button
              type="button"
              onClick={() => onStep(-1)}
              disabled={cursorIndex <= 0}
              className={iconBtn}
              aria-label="Step back"
              title="Step back (←)"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={playing ? "Pause replay" : "Play replay"}
              data-testid="vector-replay-play"
              title={playing ? "Pause (Space)" : "Play (Space)"}
              className={iconBtn}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button
              type="button"
              onClick={() => onStep(1)}
              disabled={cursorIndex >= maxIndex}
              className={iconBtn}
              aria-label="Step forward"
              title="Step forward (→)"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={onJumpOpen}
              className={iconBtn}
              title="Jump to 9:30 ET open"
            >
              Open
            </button>
            <button
              type="button"
              onClick={onJumpClose}
              className={iconBtn}
              title="Jump to session close"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onToggleLoop}
              aria-pressed={loop}
              className={clsx(
                iconBtn,
                loop && "border-gold/50 bg-gold/10 text-gold"
              )}
              title="Loop replay"
            >
              Loop
            </button>
            <select
              value={String(speed)}
              onChange={(e) => onSpeed(Number(e.target.value))}
              aria-label="Replay speed"
              className="rounded-lg border border-white/15 bg-black/40 px-1.5 py-1 font-mono text-[10px] text-cyan-400"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={String(s)}>
                  {s}×
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {replayMode && stepCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
          <input
            type="range"
            min={0}
            max={maxIndex}
            value={cursorIndex}
            onChange={(e) => onScrub(Number(e.target.value))}
            className="min-w-[140px] flex-1 accent-cyan-400"
            aria-label="Replay position"
          />
          <span className="font-mono text-[10px] text-cyan-400 tabular-nums whitespace-nowrap">
            {clockLabel}
            <span className="text-white/50">
              {" "}
              · {cursorIndex + 1}/{stepCount}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
