"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";

type Props = {
  lens: VectorWallLens;
  vexAvailable: boolean;
  onLens: (lens: VectorWallLens) => void;
  gexAsOf?: number | null;
  vexAsOf?: number | null;
  liveSession?: boolean;
};

function formatLensAge(asOf: number | null | undefined, now: number | null): string | null {
  if (asOf == null || now == null || asOf <= 0) return null;
  const s = Math.max(0, Math.floor((now - asOf) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

/** Compact GEX / VEX lens toggle — no helper copy (toolbar). */
export function VectorLensToggle({
  lens,
  vexAvailable,
  onLens,
  gexAsOf,
  vexAsOf,
  liveSession = false,
}: Props) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!liveSession) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveSession]);

  const gexAge = formatLensAge(gexAsOf, now);
  const vexAge = formatLensAge(vexAsOf, now);

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Wall exposure lens">
      {(["gex", "vex"] as const).map((key) => {
        const active = lens === key;
        const disabled = key === "vex" && !vexAvailable;
        const age = key === "gex" ? gexAge : vexAge;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onLens(key)}
            aria-pressed={active}
            data-testid={`vector-lens-${key}`}
            className={clsx(
              "font-mono text-[10px] font-bold uppercase tracking-[0.16em] rounded-lg border px-2.5 py-1.5 transition-colors",
              active && key === "gex" && "border-[#ffd60a]/70 bg-[#ffd60a]/15 text-[#ffd60a]",
              active && key === "vex" && "border-sky-400/70 bg-sky-400/15 text-sky-300",
              !active && !disabled && "border-white/15 text-cyan-400 hover:border-white/25",
              disabled && "cursor-not-allowed border-white/10 text-white/30"
            )}
          >
            {key === "gex" ? "GEX" : "VEX"}
            {liveSession && age != null ? (
              <span className="ml-1 font-normal tracking-normal text-sky-300">· {age}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
