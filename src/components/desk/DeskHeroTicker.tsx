"use client";

import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { SpxState } from "@/lib/api";
import { fmtPct, fmtPrice } from "@/lib/api";

export function DeskHeroTicker({ data, live }: { data?: SpxState; live?: boolean }) {
  const bull = (data?.spx_change_pct ?? 0) >= 0;

  return (
    <div className="desk-hero-ticker">
      <div className="desk-hero-grid" aria-hidden />
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 p-6 md:p-8">
        <div>
          <p className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-2">
            ◆ SPX Live
          </p>
          <motion.p
            key={data?.price}
            initial={{ opacity: 0.6, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-anton text-6xl md:text-8xl lg:text-9xl text-white leading-none tabular-nums"
          >
            {live ? fmtPrice(data?.price ?? null, 2) : "— — —"}
          </motion.p>
          <div className="flex flex-wrap items-center gap-4 mt-4">
            <span className={clsx("font-mono text-xl font-bold tabular-nums", bull ? "num-bull" : "num-bear")}>
              {live ? fmtPct(data?.spx_change_pct ?? null) : "—"}
            </span>
            <span className="font-mono text-sm text-sky-200">
              VIX {live && data?.vix != null ? fmtPrice(data.vix, 2) : "—"}
            </span>
            <span className="font-mono text-sm text-sky-300">
              VWAP {live ? fmtPrice(data?.vwap ?? null) : "—"}
              {live && data?.above_vwap != null && (
                <span className={data.above_vwap ? " text-bull ml-1" : " text-bear ml-1"}>
                  {data.above_vwap ? "▲ above" : "▼ below"}
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-[280px]">
          <TickerChip label="HOD" value={live ? fmtPrice(data?.hod ?? null) : "—"} />
          <TickerChip label="LOD" value={live ? fmtPrice(data?.lod ?? null) : "—"} />
          <TickerChip label="IV Rank" value={live && data?.uw_iv_rank != null ? String(data.uw_iv_rank) : "—"} />
          <TickerChip
            label="Regime"
            value={live ? (data?.chart_levels?.regime ?? "—") : "STANDBY"}
            accent
          />
        </div>
      </div>
    </div>
  );
}

function TickerChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="desk-ticker-chip">
      <p className="text-[9px] tracking-widest uppercase text-cyan-400 mb-1">{label}</p>
      <p className={clsx("font-mono text-sm font-semibold capitalize truncate", accent ? "text-bull" : "text-white")}>
        {value}
      </p>
    </div>
  );
}
