"use client";

import { VectorLensToggle } from "@/features/vector/components/VectorLensToggle";
import { VectorReplayControls } from "@/features/vector/components/VectorReplayControls";
import { VectorTimeframeSelect } from "@/features/vector/components/VectorTimeframeSelect";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import type { VectorTimeframeMinutes } from "@/features/vector/lib/vector-bar-timeframes";

type Props = {
  interval: VectorTimeframeMinutes;
  onInterval: (minutes: VectorTimeframeMinutes) => void;
  timeframeDisabled?: boolean;
  lens: VectorWallLens;
  vexAvailable: boolean;
  onLens: (lens: VectorWallLens) => void;
  gexAsOf?: number | null;
  vexAsOf?: number | null;
  liveSession?: boolean;
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

/** Single compact toolbar — timeframe left, replay + lens right. */
export function VectorToolbar(props: Props) {
  const {
    interval,
    onInterval,
    timeframeDisabled,
    lens,
    vexAvailable,
    onLens,
    gexAsOf,
    vexAsOf,
    liveSession,
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
  } = props;

  return (
    <div className="vector-toolbar mb-2" role="group" aria-label="Chart timeframe">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <VectorTimeframeSelect
          interval={interval}
          onInterval={onInterval}
          disabled={timeframeDisabled}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-end gap-2">
          <VectorReplayControls
            replayMode={replayMode}
            playing={playing}
            canReplay={canReplay}
            cursorIndex={cursorIndex}
            stepCount={stepCount}
            clockLabel={clockLabel}
            speed={speed}
            loop={loop}
            onToggleReplay={onToggleReplay}
            onTogglePlay={onTogglePlay}
            onScrub={onScrub}
            onSpeed={onSpeed}
            onStep={onStep}
            onJumpOpen={onJumpOpen}
            onJumpClose={onJumpClose}
            onToggleLoop={onToggleLoop}
          />
          <VectorLensToggle
            lens={lens}
            vexAvailable={vexAvailable}
            onLens={onLens}
            gexAsOf={gexAsOf}
            vexAsOf={vexAsOf}
            liveSession={liveSession}
          />
        </div>
      </div>
    </div>
  );
}
