"use client";

import clsx from "clsx";
import {
  VECTOR_TIMEFRAMES,
  type VectorTimeframeMinutes,
} from "@/lib/vector-bar-timeframes";

type Props = {
  interval: VectorTimeframeMinutes;
  onInterval: (minutes: VectorTimeframeMinutes) => void;
  disabled?: boolean;
};

/** TradingView-style candle interval selector — client-side aggregate from 1m SPX bars. */
export function VectorTimeframeToggle({ interval, onInterval, disabled = false }: Props) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Chart timeframe"
    >
      {VECTOR_TIMEFRAMES.map((minutes) => {
        const active = interval === minutes;
        return (
          <button
            key={minutes}
            type="button"
            disabled={disabled}
            onClick={() => onInterval(minutes)}
            aria-pressed={active}
            data-testid={`vector-tf-${minutes}m`}
            className={clsx(
              "font-mono text-[10px] font-bold uppercase tracking-[0.14em] rounded-lg border px-2.5 py-1.5 transition-colors",
              active && "border-cyan-400/70 bg-cyan-400/15 text-cyan-400",
              !active && !disabled && "border-white/15 text-sky-300 hover:border-white/25",
              disabled && "cursor-not-allowed border-white/10 text-white/30"
            )}
          >
            {minutes}m
          </button>
        );
      })}
      <span className="font-mono text-[10px] text-sky-300">
        {interval === 1 ? "Live ~1s tick" : `Built from 1m · live tick updates current ${interval}m bar`}
      </span>
    </div>
  );
}
