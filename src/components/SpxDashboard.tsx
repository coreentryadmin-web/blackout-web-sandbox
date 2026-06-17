"use client";

import useSWR from "swr";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { fetchSpxDesk, fmtPct, fmtPrice, fmtPremium } from "@/lib/api";
import { SpxSniperHeader } from "@/components/desk/SpxSniperHeader";
import { SpxTechnicalsPanel } from "@/components/desk/SpxTechnicalsPanel";
import { BenzingaNewsRail } from "@/components/desk/BenzingaNewsRail";
import { SpxChart } from "@/components/desk/SpxChart";

const REFRESH_MS = 5_000;

export function SpxDashboard() {
  const { data: desk, error } = useSWR("spx-desk", fetchSpxDesk, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: true,
  });

  const live = !error && desk?.available === true && (desk?.price ?? 0) > 0;
  const bull = (desk?.spx_change_pct ?? 0) >= 0;

  return (
    <div className="spx-sniper-desk">
      <SpxSniperHeader live={live} />

      <div className="spx-sniper-hero">
        <div className="spx-sniper-hero-grid" aria-hidden />
        <div className="relative z-10 flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] tracking-[0.45em] text-bull uppercase mb-2">
              ◆ I:SPX · Polygon + UW · {REFRESH_MS / 1000}s refresh
            </p>
            <AnimatePresence mode="popLayout">
              <motion.p
                key={desk?.price}
                initial={{ opacity: 0.5, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="font-anton text-6xl md:text-8xl text-white leading-none tabular-nums text-glow-green"
              >
                {live ? fmtPrice(desk?.price ?? null, 2) : "— — —"}
              </motion.p>
            </AnimatePresence>
            <div className="flex flex-wrap items-center gap-4 mt-4">
              <span
                className={clsx(
                  "font-mono text-xl font-bold tabular-nums",
                  bull ? "num-bull" : "num-bear"
                )}
              >
                {live ? fmtPct(desk?.spx_change_pct ?? null) : "—"}
              </span>
              <StatPill label="VIX" value={live && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"} />
              <StatPill label="VWAP" value={live ? fmtPrice(desk?.vwap ?? null) : "—"} />
              <StatPill label="HOD" value={live ? fmtPrice(desk?.hod ?? null) : "—"} />
              <StatPill label="LOD" value={live ? fmtPrice(desk?.lod ?? null) : "—"} />
              <StatPill
                label="GEX"
                value={live && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
                accent
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-[240px]">
            <StatPill label="Regime" value={live ? (desk?.regime ?? "—") : "—"} accent />
            <StatPill label="γ Flip" value={live && desk?.gamma_flip ? fmtPrice(desk.gamma_flip) : "—"} />
            <StatPill label="Max Pain" value={live ? fmtPrice(desk?.max_pain ?? null) : "—"} />
            <StatPill
              label="IV Rank"
              value={live && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"}
            />
          </div>
        </div>
      </div>

      <div className="spx-sniper-main spx-sniper-triple">
        <SpxTechnicalsPanel desk={desk} live={live} />
        <div className="spx-sniper-chart-col">
          <SpxChart height={640} />
        </div>
        <BenzingaNewsRail />
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="spx-stat-pill">
      <p className="text-[8px] tracking-widest uppercase text-grey-500 mb-0.5">{label}</p>
      <p
        className={clsx(
          "font-mono text-xs font-semibold tabular-nums capitalize truncate",
          accent ? "text-bull" : "text-white"
        )}
      >
        {value}
      </p>
    </div>
  );
}
