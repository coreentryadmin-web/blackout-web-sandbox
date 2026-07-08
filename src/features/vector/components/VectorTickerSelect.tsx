"use client";

import { useRouter } from "next/navigation";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { VECTOR_DEFAULT_TICKER } from "@/features/vector/lib/vector-ticker";

const PRESETS = vectorUniverseTickers();

type Props = {
  ticker: string;
};

/** Quick ticker switcher — navigates to /vector?ticker=X (one SSE stream at a time). */
export function VectorTickerSelect({ ticker }: Props) {
  const router = useRouter();
  const active = (ticker || VECTOR_DEFAULT_TICKER).toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="vector-ticker-select" className="text-xs uppercase tracking-wide text-cyan-300">
        Symbol
      </label>
      <select
        id="vector-ticker-select"
        value={active}
        onChange={(e) => {
          const next = e.target.value;
          router.push(next === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(next)}`);
        }}
        className="rounded-md border border-cyan-500/30 bg-black/60 px-2 py-1 text-sm text-white"
      >
        {PRESETS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}
