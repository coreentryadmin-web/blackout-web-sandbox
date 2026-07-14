"use client";

import type { VectorDarkPoolLevel, VectorWallLevel } from "@/lib/api";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";

export type VectorCrosshairState = {
  time: string;
  close: number | null;
  lens: VectorWallLens;
  flip: number | null;
  callWalls: VectorWallLevel[];
  putWalls: VectorWallLevel[];
  darkPoolLevels: VectorDarkPoolLevel[];
};

type Props = {
  state: VectorCrosshairState | null;
  /** The active ticker — the price readout was hardcoded to "SPX", so every other
   *  ticker (RKLB, SNOW, …) mislabeled its own spot as SPX. */
  ticker: string;
};

function fmtStrike(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function VectorCrosshairLegend({ state, ticker }: Props) {
  if (!state) return null;

  const isVex = state.lens === "vex";
  const callClass = isVex ? "text-sky-300" : "text-[#ffd60a]";
  const putClass = isVex ? "text-rose-300" : "text-[#b26bff]";
  const callLabel = isVex ? "Vanna +" : "Call";
  const putLabel = isVex ? "Vanna −" : "Put";
  const flipLabel = isVex ? "Vanna flip" : "γ flip";

  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(100%,420px)] flex-col gap-1 rounded-md border border-white/10 bg-[#040407]/90 px-3 py-2 font-mono text-[11px] leading-snug text-white shadow-lg backdrop-blur-sm"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-sky-300">{state.time}</span>
        <span className="uppercase tracking-wider text-cyan-400">{state.lens}</span>
        {state.close != null && (
          <span>
            {ticker} <span className="text-cyan-400">{fmtStrike(state.close)}</span>
          </span>
        )}
        {state.flip != null && (
          <span>
            {flipLabel} <span className="text-cyan-400">{fmtStrike(state.flip)}</span>
          </span>
        )}
      </div>
      {state.callWalls.length > 0 && (
        <div className={callClass}>
          {callLabel}{" "}
          {state.callWalls
            .slice(0, 3)
            .map((w) => `${fmtStrike(w.strike)} (${w.pct.toFixed(0)}%)`)
            .join(" · ")}
        </div>
      )}
      {state.putWalls.length > 0 && (
        <div className={putClass}>
          {putLabel}{" "}
          {state.putWalls
            .slice(0, 3)
            .map((w) => `${fmtStrike(w.strike)} (${w.pct.toFixed(0)}%)`)
            .join(" · ")}
        </div>
      )}
      {state.darkPoolLevels.length > 0 && (
        <div className="text-[#ff8a3d]">
          DP{" "}
          {state.darkPoolLevels
            .slice(0, 3)
            .map((l) => `${fmtStrike(l.strike)} (${l.pct.toFixed(0)}%)`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
