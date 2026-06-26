"use client";

import { clsx } from "clsx";
import { useSpxDayPerformance } from "@/hooks/useSpxDayPerformance";
import { Panel, Stat, Skeleton } from "@/components/ui";

/**
 * Compact one-line collapse for the empty / error states — see SpxTrackRecordPanel
 * for the rationale. No grey: cyan/sky for muted, rose for a real failure.
 */
function CollapsedLine({ tone, children }: { tone: "muted" | "error"; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 font-mono text-[11px]">
      <span
        aria-hidden
        className={clsx(
          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          tone === "error" ? "bg-rose-400" : "bg-sky-500/60"
        )}
      />
      <span className={tone === "error" ? "text-rose-300" : "text-cyan-400"}>{children}</span>
    </div>
  );
}

export function SpxDayPerformancePanel() {
  const { stats, loading, error } = useSpxDayPerformance();

  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

  if (loading) {
    return (
      <Panel accent="sky" kicker={`${today} · P&L`} title="Today">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height={32} rounded="md" />
          ))}
        </div>
      </Panel>
    );
  }

  // ERROR: distinguish a backend failure from a quiet "no plays today" session.
  if (error) {
    return <CollapsedLine tone="error">Today’s P&amp;L unavailable — retrying…</CollapsedLine>;
  }

  const noPlays = !stats || stats.plays === 0;

  // EMPTY: no closed plays yet today. Collapse to a single line so the live
  // GEX Walls + Live Tape panels below get the vertical space.
  if (noPlays) {
    return <CollapsedLine tone="muted">{today} · P&amp;L · no closed plays yet today</CollapsedLine>;
  }

  return (
    <Panel
      accent="sky"
      kicker={`${today} · P&L`}
      title="Today"
      actions={
        <span
          className={clsx(
            "font-mono text-xs font-bold tabular-nums",
            stats.net_pts >= 0 ? "num-bull" : "num-bear"
          )}
        >
          {stats.net_pts >= 0 ? "+" : ""}
          {stats.net_pts} pts
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat
          compact
          label="Plays"
          value={
            <>
              {stats.wins}W / {stats.losses}L
              {stats.breakeven > 0 && (
                <span className="text-cyan-400 font-normal"> / {stats.breakeven}BE</span>
              )}
            </>
          }
        />
        <Stat
          compact
          label="Win Rate"
          value={stats.win_rate != null ? `${Math.round(stats.win_rate * 100)}%` : "—"}
          tone={stats.win_rate == null ? "accent" : stats.win_rate >= 0.5 ? "bull" : "bear"}
        />
        <Stat
          compact
          label="Avg Win"
          value={stats.avg_win_pts != null ? `+${stats.avg_win_pts}` : "—"}
          tone="bull"
        />
        <Stat
          compact
          label="Avg Loss"
          value={stats.avg_loss_pts != null ? `${stats.avg_loss_pts}` : "—"}
          tone="bear"
        />
      </div>
    </Panel>
  );
}
