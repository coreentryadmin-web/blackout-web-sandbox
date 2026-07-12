"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  VECTOR_PRESET_TIMEFRAMES,
  VECTOR_INTERVAL_MAX,
  VECTOR_INTERVAL_MIN,
  isPresetTimeframe,
  normalizeVectorIntervalMinutes,
  type VectorTimeframeMinutes,
} from "@/features/vector/lib/vector-bar-timeframes";

const CUSTOM_VALUE = "custom";

type Props = {
  interval: VectorTimeframeMinutes;
  onInterval: (minutes: VectorTimeframeMinutes) => void;
  disabled?: boolean;
};

function presetLabel(minutes: number): string {
  // Whole-hour intervals read cleaner as "1H"/"2H" than "60 min"/"120 min".
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes} min`;
}

/** Candle interval dropdown — presets plus custom whole-minute buckets. */
export function VectorTimeframeSelect({ interval, onInterval, disabled = false }: Props) {
  const preset = isPresetTimeframe(interval);
  const [mode, setMode] = useState<"preset" | "custom">(preset ? "preset" : "custom");
  const [customDraft, setCustomDraft] = useState(String(preset ? 10 : interval));

  useEffect(() => {
    if (isPresetTimeframe(interval)) {
      setMode("preset");
    } else {
      setMode("custom");
      setCustomDraft(String(interval));
    }
  }, [interval]);

  const selectValue = mode === "custom" ? CUSTOM_VALUE : String(interval);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="vector-tf-select">
        Chart timeframe
      </label>
      <select
        id="vector-tf-select"
        data-testid="vector-tf-select"
        disabled={disabled}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_VALUE) {
            setMode("custom");
            const parsed = normalizeVectorIntervalMinutes(Number(customDraft) || 10);
            setCustomDraft(String(parsed));
            onInterval(parsed);
            return;
          }
          setMode("preset");
          onInterval(Number(v));
        }}
        className={clsx(
          "font-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-lg border px-2.5 py-1.5",
          "border-cyan-400/50 bg-cyan-400/10 text-cyan-400",
          disabled && "cursor-not-allowed opacity-40"
        )}
      >
        {VECTOR_PRESET_TIMEFRAMES.map((m) => (
          <option key={m} value={String(m)}>
            {presetLabel(m)}
          </option>
        ))}
        <option value={CUSTOM_VALUE}>Custom…</option>
      </select>

      {mode === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={VECTOR_INTERVAL_MIN}
            max={VECTOR_INTERVAL_MAX}
            step={1}
            disabled={disabled}
            data-testid="vector-tf-custom"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onBlur={() => {
              const parsed = normalizeVectorIntervalMinutes(Number(customDraft));
              setCustomDraft(String(parsed));
              onInterval(parsed);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const parsed = normalizeVectorIntervalMinutes(Number(customDraft));
                setCustomDraft(String(parsed));
                onInterval(parsed);
              }
            }}
            className="w-16 rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-mono text-[10px] text-white"
            aria-label="Custom interval minutes"
          />
          <span className="font-mono text-[10px] text-sky-300">min</span>
        </div>
      )}
    </div>
  );
}
