"use client";

import { clsx } from "clsx";
import { useSpxTrackRecord } from "@/hooks/useSpxTrackRecord";
import { Panel, Stat, Skeleton, type StatTone } from "@/components/ui";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function winRateTone(v: number): StatTone {
  return v >= 0.5 ? "bull" : "bear";
}

/**
 * Compact one-line collapse for the empty / error states. Deliberately NOT a full
 * Panel: a perpetually-empty Track Record used to render a full-height card that
 * pushed the live GEX Walls + Live Tape panels below the fold. When there is no
 * data we shrink to a single muted line so the live panels get the vertical space.
 * Brand: no grey — cyan/sky per the no-grey rule.
 */
function CollapsedLine({ tone, children }: { tone: "muted" | "error"; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 font-mono text-[11px]">
      <span
        aria-hidden
        className={clsx(
          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          tone === "error" ? "bg-rose-400" : "bg-cyan-500/60"
        )}
      />
      <span className={tone === "error" ? "text-rose-300" : "text-cyan-400"}>{children}</span>
    </div>
  );
}

export function SpxTrackRecordPanel() {
  const { stats, loading, error } = useSpxTrackRecord();

  if (loading) {
    return (
      <Panel accent="accent" kicker="ALL CLOSED PLAYS" title="Track Record">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height={32} rounded="md" />
          ))}
        </div>
      </Panel>
    );
  }

  // ERROR: the outcomes route 502'd. Surface it as a real failure — NOT "warming
  // up" — so a backend outage doesn't masquerade as an empty track record.
  if (error) {
    return (
      <CollapsedLine tone="error">
        Track record unavailable — retrying…
      </CollapsedLine>
    );
  }

  const empty = !stats || stats.total_closed === 0;

  // EMPTY: genuinely no closed plays yet. Collapse to a single line.
  if (empty) {
    return <CollapsedLine tone="muted">Track record · no closed plays yet</CollapsedLine>;
  }

  const overallWr = stats.overall.win_rate;

  return (
    <Panel
      accent="accent"
      kicker="ALL CLOSED PLAYS"
      title="Track Record"
      actions={
        <span
          className={clsx(
            "font-mono text-xs font-bold tabular-nums",
            overallWr >= 0.5 ? "num-bull" : "num-bear"
          )}
        >
          {pct(overallWr)}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat
          compact
          label="Win Rate"
          value={pct(overallWr)}
          tone={winRateTone(overallWr)}
        />
        <Stat
          compact
          label="Record"
          value={
            <>
              {stats.overall.wins}W / {stats.overall.losses}L
              {stats.overall.breakeven > 0 && (
                <span className="text-sky-300 font-normal"> / {stats.overall.breakeven}BE</span>
              )}
            </>
          }
        />
        <Stat compact label="Closed" value={stats.total_closed} sublabel="plays" />
        <Stat compact label="History" value={Math.round(stats.days_of_data)} sublabel="days" />
        {stats.cold_buy.count > 0 && (
          <Stat
            compact
            label="Cold BUY"
            value={pct(stats.cold_buy.win_rate)}
            tone={winRateTone(stats.cold_buy.win_rate)}
            sublabel={`${stats.cold_buy.count} plays`}
          />
        )}
        {stats.watch_promote.count > 0 && (
          <Stat
            compact
            label="WATCH→ENTRY"
            value={pct(stats.watch_promote.win_rate)}
            tone={winRateTone(stats.watch_promote.win_rate)}
            sublabel={`${stats.watch_promote.count} plays`}
          />
        )}
      </div>
    </Panel>
  );
}
