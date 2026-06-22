"use client";

import { clsx } from "clsx";
import { useSpxDayPerformance } from "@/hooks/useSpxDayPerformance";

export function SpxDayPerformancePanel() {
  const { stats, loading } = useSpxDayPerformance();

  if (loading) {
    return (
      <div className="spx-desk-panel spx-panel-purple animate-pulse">
        <div className="spx-desk-panel-header">
          <span className="badge-live-dot" />
          <p className="font-syne text-xs tracking-[0.12em] uppercase font-bold">Today</p>
        </div>
        <div className="spx-desk-panel-body">
          <div className="grid grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-8 bg-neutral-700/50 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const noPlays = !stats || stats.plays === 0;
  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

  return (
    <div className="spx-desk-panel spx-panel-purple">
      <div className="spx-desk-panel-header">
        <span className="badge-live-dot animate-pulse" />
        <div>
          <p className="font-syne text-xs tracking-[0.12em] uppercase font-bold">Today</p>
          <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-cyan-400 mt-0.5">
            {today} · P&amp;L
          </p>
        </div>
        {stats && stats.plays > 0 && (
          <span
            className={clsx(
              "ml-auto font-mono text-xs font-bold tabular-nums",
              stats.net_pts >= 0 ? "num-bull" : "num-bear"
            )}
          >
            {stats.net_pts >= 0 ? "+" : ""}
            {stats.net_pts} pts
          </span>
        )}
      </div>

      <div className="spx-desk-panel-body">
        {noPlays ? (
          <p className="font-mono text-[11px] text-cyan-400 py-2">No completed plays today</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                Plays
              </div>
              <div className="font-syne font-bold text-white">
                {stats!.wins}W / {stats!.losses}L
                {stats!.breakeven > 0 && (
                  <span className="text-cyan-400 font-normal"> / {stats!.breakeven}BE</span>
                )}
              </div>
            </div>

            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                Win Rate
              </div>
              <div
                className={clsx(
                  "font-syne font-bold tabular-nums",
                  stats!.win_rate == null
                    ? "text-cyan-400"
                    : stats!.win_rate >= 0.5
                    ? "num-bull"
                    : "num-bear"
                )}
              >
                {stats!.win_rate != null ? `${Math.round(stats!.win_rate * 100)}%` : "—"}
              </div>
            </div>

            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                Avg Win
              </div>
              <div className="font-syne font-bold num-bull tabular-nums">
                {stats!.avg_win_pts != null ? `+${stats!.avg_win_pts}` : "—"}
              </div>
            </div>

            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400 mb-0.5">
                Avg Loss
              </div>
              <div className="font-syne font-bold num-bear tabular-nums">
                {stats!.avg_loss_pts != null ? `${stats!.avg_loss_pts}` : "—"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
