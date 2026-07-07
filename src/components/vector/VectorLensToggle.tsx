"use client";

import clsx from "clsx";
import type { VectorWallLens } from "@/lib/providers/vector-wall-history";

type Props = {
  lens: VectorWallLens;
  vexAvailable: boolean;
  onLens: (lens: VectorWallLens) => void;
};

/** GEX / VEX exposure lens — matches SPX Slayer matrix toggle styling. */
export function VectorLensToggle({ lens, vexAvailable, onLens }: Props) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Wall exposure lens"
    >
      {(["gex", "vex"] as const).map((key) => {
        const active = lens === key;
        const disabled = key === "vex" && !vexAvailable;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onLens(key)}
            aria-pressed={active}
            data-testid={`vector-lens-${key}`}
            className={clsx(
              "font-mono text-[10px] font-bold uppercase tracking-[0.18em] rounded-lg border px-3 py-1.5 transition-colors",
              active && key === "gex" && "border-[#ffd60a]/70 bg-[#ffd60a]/15 text-[#ffd60a]",
              active && key === "vex" && "border-sky-400/70 bg-sky-400/15 text-sky-300",
              !active && !disabled && "border-white/15 text-cyan-400 hover:border-white/25",
              disabled && "cursor-not-allowed border-white/10 text-white/30"
            )}
          >
            {key === "gex" ? "GEX" : "VEX"}
          </button>
        );
      })}
      <span className="font-mono text-[10px] text-sky-300">
        {lens === "gex"
          ? "Gamma walls ~1s · beads every 15s"
          : "Vanna walls from heatmap ~8s · beads every 15s"}
      </span>
    </div>
  );
}
