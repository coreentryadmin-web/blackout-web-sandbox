"use client";

import { motion } from "framer-motion";
import { clsx } from "clsx";
import { useEffect, useRef } from "react";
import type { SpxState } from "@/lib/api";
import { fmtPct, fmtPrice } from "@/lib/api";

/**
 * VITALS Phase 1 — attach data-flash on value update.
 * Adds the CSS class, animation plays (300ms), then the class is removed.
 * The `key` prop on the parent element already handles React re-mount,
 * but this hook provides the flash on the element's DOM node directly so
 * it fires even on framer-motion-animated wrappers.
 */
function useDataFlash(value: number | null | undefined, ref: React.RefObject<HTMLElement | null>) {
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value && value != null && ref.current) {
      const el = ref.current;
      el.classList.remove("data-flash");
      // Force reflow so removing + re-adding the class restarts animation.
      void el.offsetWidth;
      el.classList.add("data-flash");
      const tid = window.setTimeout(() => el.classList.remove("data-flash"), 350);
      prev.current = value;
      return () => window.clearTimeout(tid);
    }
    prev.current = value;
  }, [value, ref]);
}

export function DeskHeroTicker({ data, live }: { data?: SpxState; live?: boolean }) {
  const bull = (data?.spx_change_pct ?? 0) >= 0;

  // VITALS Phase 1 — data-flash refs for live numeric values.
  const priceRef = useRef<HTMLParagraphElement>(null);
  const vixRef = useRef<HTMLSpanElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  useDataFlash(live ? (data?.price ?? null) : null, priceRef);
  useDataFlash(live ? (data?.vix ?? null) : null, vixRef);
  useDataFlash(live ? (data?.spx_change_pct ?? null) : null, pctRef);

  return (
    <div className="desk-hero-ticker">
      <div className="desk-hero-grid" aria-hidden />
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 p-6 md:p-8">
        <div>
          <p className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-2">
            ◆ SPX Live
          </p>
          <motion.p
            ref={priceRef}
            key={data?.price}
            initial={{ opacity: 0.6, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-anton text-6xl md:text-8xl lg:text-9xl text-white leading-none tabular-nums"
          >
            {live ? fmtPrice(data?.price ?? null, 2) : "— — —"}
          </motion.p>
          <div className="flex flex-wrap items-center gap-4 mt-4">
            <span ref={pctRef} className={clsx("font-mono text-xl font-bold tabular-nums", bull ? "num-bull" : "num-bear")}>
              {live ? fmtPct(data?.spx_change_pct ?? null) : "—"}
            </span>
            <span ref={vixRef} className="font-mono text-sm text-sky-200">
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
      <p className="text-[10px] tracking-widest uppercase text-cyan-400 mb-1">{label}</p>
      <p className={clsx("font-mono text-sm font-semibold capitalize truncate", accent ? "text-bull" : "text-white")}>
        {value}
      </p>
    </div>
  );
}
