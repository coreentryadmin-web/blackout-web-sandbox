"use client";

import { DeskPanel } from "./DeskPanel";
import type { SpxState } from "@/lib/api";
import { fmtPrice } from "@/lib/api";
import { clsx } from "clsx";

type Level = { label: string; value: number | null; kind?: "support" | "resistance" | "neutral" };

export function LevelLadder({ data, live }: { data?: SpxState; live?: boolean }) {
  const c = data?.chart_levels;
  const price = data?.price ?? 0;

  const levels: Level[] = [
    { label: "ONH", value: c?.onh ?? null, kind: "resistance" as const },
    { label: "PDH", value: c?.pdh ?? null, kind: "resistance" as const },
    { label: "VAH", value: c?.vah ?? null, kind: "resistance" as const },
    { label: "POC", value: c?.poc ?? null, kind: "neutral" as const },
    { label: "Fib 50%", value: c?.fib_50 ?? null, kind: "neutral" as const },
    { label: "VAL", value: c?.val ?? null, kind: "support" as const },
    { label: "PDL", value: c?.pdl ?? null, kind: "support" as const },
    { label: "ONL", value: c?.onl ?? null, kind: "support" as const },
  ].filter((l) => l.value != null || !live);

  const sorted = [...levels].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return (
    <DeskPanel title="Level Ladder" subtitle="Key strikes & structure" variant="green" live={live}>
      <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
        {sorted.map((level) => {
          const dist = live && level.value != null && price ? ((level.value - price) / price) * 100 : null;
          const isNear = dist != null && Math.abs(dist) < 0.15;

          return (
            <div
              key={level.label}
              className={clsx(
                "desk-level-row",
                level.kind === "support" && "desk-level-support",
                level.kind === "resistance" && "desk-level-resistance",
                isNear && "desk-level-near"
              )}
            >
              <span className="text-[10px] font-mono uppercase tracking-wider text-sky-300 w-20 shrink-0">
                {level.label}
              </span>
              <span className="font-mono text-sm text-white tabular-nums flex-1">
                {live ? fmtPrice(level.value) : "—"}
              </span>
              {dist != null && (
                <span className={clsx("font-mono text-[10px] tabular-nums", dist >= 0 ? "text-bull" : "text-bear")}>
                  {dist >= 0 ? "+" : ""}
                  {dist.toFixed(2)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </DeskPanel>
  );
}
