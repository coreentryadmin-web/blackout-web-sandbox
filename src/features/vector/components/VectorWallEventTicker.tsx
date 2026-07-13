"use client";

import { useState } from "react";
import clsx from "clsx";
import type { VectorWallEvent, VectorWallEventKind } from "@/features/vector/lib/vector-wall-events";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { formatReplayClock } from "@/features/vector/lib/vector-replay";

type Props = {
  events: VectorWallEvent[];
  lens: VectorWallLens;
};

const KIND_LABEL: Record<VectorWallEventKind, string> = {
  call_wall_shift: "SHIFT",
  put_wall_shift: "SHIFT",
  flip_shift: "FLIP",
  spot_crossed_flip: "CROSS",
  spot_broke_call: "BREAK",
  spot_broke_put: "BREAK",
  call_wall_building: "BUILD",
  put_wall_building: "BUILD",
  call_wall_fading: "FADE",
  put_wall_fading: "FADE",
  call_wall_new: "NEW",
  put_wall_new: "NEW",
  call_wall_gone: "GONE",
  put_wall_gone: "GONE",
};

const BUILD_TONE = "border-emerald-400/40 text-emerald-300";
const FADE_TONE = "border-amber-400/40 text-amber-300";
const KIND_TONE: Record<VectorWallEventKind, string> = {
  call_wall_shift: "border-cyan-400/40 text-cyan-400",
  put_wall_shift: "border-cyan-400/40 text-cyan-400",
  flip_shift: "border-sky-400/40 text-sky-300",
  spot_crossed_flip: "border-[#ffd60a]/40 text-[#ffd60a]",
  spot_broke_call: "border-rose-400/40 text-rose-300",
  spot_broke_put: "border-rose-400/40 text-rose-300",
  call_wall_building: BUILD_TONE,
  put_wall_building: BUILD_TONE,
  call_wall_fading: FADE_TONE,
  put_wall_fading: FADE_TONE,
  call_wall_new: "border-cyan-400/40 text-cyan-300",
  put_wall_new: "border-cyan-400/40 text-cyan-300",
  call_wall_gone: FADE_TONE,
  put_wall_gone: FADE_TONE,
};

/** Collapsible wall-structure feed — collapsed by default to preserve chart height. */
export function VectorWallEventTicker({ events, lens }: Props) {
  const [open, setOpen] = useState(false);
  const visible = events.filter((e) => e.lens === lens).slice(-6).reverse();
  const count = visible.length;

  return (
    <div className="mb-2 rounded-lg border border-white/10 bg-white/[0.02]" aria-label="Wall structure events">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left"
        aria-expanded={open}
      >
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">
          Structure feed
        </span>
        <span className="font-mono text-[10px] text-sky-300">
          {lens.toUpperCase()}
          {count > 0 ? ` · ${count}` : ""}
          <span className="ml-2 text-white/50">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 px-3 py-2">
          {visible.length === 0 ? (
            <p className="font-mono text-[11px] leading-snug text-sky-300">
              No {lens.toUpperCase()} shifts yet.
            </p>
          ) : (
            <ul className="flex max-h-24 flex-col gap-1.5 overflow-y-auto pr-1">
              {visible.map((event, i) => (
                <li
                  key={`${event.time}-${event.kind}-${i}`}
                  className="flex items-start gap-2 font-mono text-[11px] leading-snug"
                >
                  <span
                    className={clsx(
                      "mt-px shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold tracking-[0.12em]",
                      KIND_TONE[event.kind]
                    )}
                  >
                    {KIND_LABEL[event.kind]}
                  </span>
                  <span className={event.severity === "warn" ? "text-rose-300" : "text-white"}>
                    <span className="text-sky-300">{formatReplayClock(event.time)}</span>
                    <span className="text-white/40"> · </span>
                    {event.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
