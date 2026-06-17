"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
};

export function SpxSniperHeader({ desk, live }: Props) {
  const bull = (desk?.spx_change_pct ?? 0) >= 0;

  return (
    <header className="spx-sniper-command">
      <div className="spx-sniper-command-grid" aria-hidden />
      <div className="spx-sniper-command-glow" aria-hidden />
      <div className="spx-sniper-command-scan" aria-hidden />
      <div className="relative z-10">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
          <div className="flex flex-col md:flex-row md:items-end gap-5 md:gap-8 min-w-0 flex-1">
            <div className="shrink-0">
              <p className="font-mono text-[9px] tracking-[0.45em] text-bull/80 uppercase mb-1">
                ◆ BlackOut Ops
              </p>
              <h1 className="spx-sniper-title">
                <span className="text-stroke-green">SPX</span>
                <span className="text-white">-</span>
                <span className="text-gradient-fire">SNIPER</span>
              </h1>
              <p className="spx-hero-tagline font-mono text-[10px] tracking-[0.32em] uppercase mt-1.5">
                Precision · Patience · 0DTE Structure
              </p>
            </div>

            <div className="min-w-0">
              <AnimatePresence mode="popLayout">
                <motion.p
                  key={desk?.price}
                  initial={{ opacity: 0.5, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={clsx(
                    "font-anton text-5xl sm:text-6xl md:text-7xl text-white leading-none tabular-nums",
                    bull ? "text-glow-green" : "text-glow-red"
                  )}
                >
                  {live ? fmtPrice(desk?.price ?? null, 2) : "— — —"}
                </motion.p>
              </AnimatePresence>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span
                  className={clsx(
                    "font-mono text-lg font-bold tabular-nums",
                    bull ? "num-bull" : "num-bear"
                  )}
                >
                  {live ? fmtPct(desk?.spx_change_pct ?? null) : "—"}
                </span>
                <StatPill label="VIX" value={live && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"} tone="orange" />
                <StatPill
                  label="VWAP"
                  value={live ? fmtPrice(desk?.vwap ?? null) : "—"}
                  tone={desk?.above_vwap ? "bull" : "bear"}
                />
                <StatPill label="HOD" value={live ? fmtPrice(desk?.hod ?? null) : "—"} tone="resistance" />
                <StatPill label="LOD" value={live ? fmtPrice(desk?.lod ?? null) : "—"} tone="support" />
                <StatPill
                  label="GEX"
                  value={live && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
                  tone={(desk?.gex_net ?? 0) >= 0 ? "bull" : "bear"}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start xl:items-end gap-3 shrink-0">
            <span className={clsx("spx-command-live", live && "spx-command-live-on animate-pulse")}>
              <span className={clsx("badge-live-dot", live && "animate-pulse")} />
              {live ? "Live Fire" : "Standby"}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full xl:w-auto min-w-[200px]">
              <StatPill label="Regime" value={live ? (desk?.regime ?? "—") : "—"} tone="violet" hot />
              <StatPill label="γ Flip" value={live && desk?.gamma_flip ? fmtPrice(desk.gamma_flip) : "—"} tone="magenta" />
              <StatPill label="Max Pain" value={live ? fmtPrice(desk?.max_pain ?? null) : "—"} tone="cyan" />
              <StatPill
                label="IV Rank"
                value={live && desk?.uw_iv_rank != null ? String(desk.uw_iv_rank) : "—"}
                tone="gold"
              />
            </div>
          </div>
        </div>

        {live && desk?.as_of && (
          <p className="spx-hero-desk-tick mt-4 font-mono text-[10px] tracking-wider">
            Desk · {new Date(desk.as_of).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
          </p>
        )}
      </div>
    </header>
  );
}

const PILL_BORDER: Record<string, string> = {
  bull: "border-emerald-500/40",
  bear: "border-rose-500/40",
  support: "border-emerald-500/35",
  resistance: "border-rose-500/35",
  orange: "border-orange-500/40",
  violet: "border-violet-500/40",
  magenta: "border-fuchsia-500/40",
  cyan: "border-cyan-500/40",
  gold: "border-amber-500/40",
  neutral: "border-grey-700",
};

const VALUE_TONE: Record<string, string> = {
  bull: "text-emerald-300",
  bear: "text-rose-300",
  support: "text-emerald-300",
  resistance: "text-rose-300",
  orange: "text-orange-300",
  violet: "text-violet-200",
  magenta: "text-fuchsia-300",
  cyan: "text-cyan-300",
  gold: "text-amber-200",
  neutral: "text-zinc-100",
};

function StatPill({
  label,
  value,
  tone = "neutral",
  hot,
  capitalize: cap,
}: {
  label: string;
  value: string;
  tone?: string;
  hot?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div
      className={clsx(
        "spx-hero-stat-pill",
        PILL_BORDER[tone] ?? PILL_BORDER.neutral,
        hot && "spx-stat-pill-glow"
      )}
    >
      <p className="spx-hero-stat-label">{label}</p>
      <p className={clsx("spx-hero-stat-value", cap && "capitalize", VALUE_TONE[tone] ?? VALUE_TONE.neutral)}>
        {value}
      </p>
    </div>
  );
}
