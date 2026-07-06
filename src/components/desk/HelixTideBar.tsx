"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { fetchSpxState, type SpxState } from "@/lib/api";

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Compact market tide indicator for the HELIX page header. Reads from the shared
 * SPX desk merged payload (cache-reader — no extra upstream call). Shows:
 *   - Call vs put tide premium split bar
 *   - Directional bias pill (BULLISH / BEARISH / NEUTRAL)
 * Zero new API paths: reuses fetchSpxState → /api/market/spx/merged.
 */
export function HelixTideBar() {
  const { data } = useSWR<SpxState>("helix-tide", fetchSpxState, { refreshInterval: 15_000 });

  const tideBias = (data?.tide_bias ?? "").toLowerCase();
  const callPrem = data?.tide_call ?? null;
  const putPrem = data?.tide_put ?? null;

  // No data or market closed — render nothing (self-hides cleanly).
  if (!data?.available || (callPrem == null && putPrem == null && !tideBias)) return null;

  const call = callPrem ?? 0;
  const put = putPrem ?? 0;
  const gross = call + put;
  const callPct = gross > 0 ? (call / gross) * 100 : 50;

  const isBull = tideBias.includes("bull");
  const isBear = tideBias.includes("bear");
  const biasLabel = isBull ? "BULLISH" : isBear ? "BEARISH" : "NEUTRAL";
  const biasCls = isBull
    ? "bg-emerald-400/15 text-emerald-400 outline-emerald-400/50"
    : isBear
    ? "bg-[#ff5c78]/15 text-[#ff5c78] outline-[#ff5c78]/50"
    : "bg-sky-400/15 text-sky-300 outline-sky-400/50";

  return (
    <div className="helix-tide-bar flex items-center gap-3 rounded-lg border border-white/8 bg-[rgba(8,9,14,0.5)] px-3 py-2">
      {/* Bias pill */}
      <span
        className={clsx(
          "shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider outline outline-1",
          biasCls
        )}
      >
        {biasLabel}
      </span>

      {/* Call/put premium split bar */}
      <div className="flex min-w-[80px] flex-1 flex-col gap-0.5">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-[rgba(8,9,14,0.8)]">
          <span
            className="h-full transition-[width] duration-500"
            style={{ width: `${callPct.toFixed(1)}%`, backgroundColor: "#00e676", boxShadow: "0 0 6px #00e67666" }}
          />
          <span
            className="h-full flex-1"
            style={{ backgroundColor: "#ff2d55", boxShadow: "0 0 6px #ff2d5566" }}
          />
        </div>
        <div className="flex justify-between font-mono text-[9px] tabular-nums">
          {call > 0 && <span className="text-emerald-400">{fmtMoney(call)} calls</span>}
          {put > 0 && <span className="text-[#ff5c78]">{fmtMoney(put)} puts</span>}
        </div>
      </div>

      {/* Tide label */}
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-sky-300/60">
        Tide
      </span>
    </div>
  );
}
