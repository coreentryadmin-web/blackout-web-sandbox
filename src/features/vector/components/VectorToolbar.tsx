import { VectorDteToggle } from "@/features/vector/components/VectorDteToggle";
"use client";

import { VectorLensToggle } from "@/features/vector/components/VectorLensToggle";
import { VectorReplayControls } from "@/features/vector/components/VectorReplayControls";
import { VectorTimeframeSelect } from "@/features/vector/components/VectorTimeframeSelect";
import { VectorIndicatorMenu } from "@/features/vector/components/VectorIndicatorMenu";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import type { VectorTimeframeMinutes } from "@/features/vector/lib/vector-bar-timeframes";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorIndicatorId } from "@/features/vector/lib/vector-indicators-config";

type Props = {
  interval: VectorTimeframeMinutes;
  onInterval: (minutes: VectorTimeframeMinutes) => void;
  timeframeDisabled?: boolean;
  lens: VectorWallLens;
  vexAvailable: boolean;
  onLens: (lens: VectorWallLens) => void;
  dteHorizon: VectorDteHorizon;
  onDteHorizon: (h: VectorDteHorizon) => void;
  dteAvailable: boolean;
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
  indicators: Set<VectorIndicatorId>;
  onToggleIndicator: (id: VectorIndicatorId) => void;
  onClearIndicators: () => void;
  /** Bars currently shown (at the active timeframe) — drives the MA "not enough bars" annotation. */
  barCount: number;
  /** Compact page title/ticker cluster, rendered at the far LEFT of the toolbar row (so the header
   *  and the timeframe/indicator controls share one line instead of a tall separate header block). */
  leadSlot?: React.ReactNode;
  /** Freshness/status chip, rendered at the far RIGHT of the toolbar row, aligned with the title. */
  trailSlot?: React.ReactNode;
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
    dteHorizon,
    onDteHorizon,
    dteAvailable,
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
    indicators,
    onToggleIndicator,
    onClearIndicators,
    barCount,
    leadSlot,
    trailSlot,
  } = props;

  return (
    <div className="vector-toolbar mb-2" role="group" aria-label="Chart timeframe">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {leadSlot}
          <VectorTimeframeSelect
            interval={interval}
            onInterval={onInterval}
            disabled={timeframeDisabled}
          />
          <VectorIndicatorMenu
            enabled={indicators}
            onToggle={onToggleIndicator}
            onClear={onClearIndicators}
            barCount={barCount}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
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
          {/* DTE horizon toggle: 0DTE / Weekly / Monthly. The "All" option was removed
              (user-directed, 2026-07-13) — see VectorDteToggle for the rationale. */}
          {lens === "gex" && (
            <VectorDteToggle
              horizon={dteHorizon}
              onHorizon={onDteHorizon}
              available={dteAvailable}
              disabled={replayMode}
            />
          )}
          {trailSlot}
        </div>
      </div>
    </div>
  );
}
