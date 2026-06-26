import type { ReactNode } from "react";
import { clsx } from "clsx";
import { EmbedFrame } from "./EmbedFrame";
import type { PublicTrackRecord } from "@/lib/track-record-public";

/**
 * Presentational social-proof card. PURE props in (no fetching) so it renders
 * both server-side (public /track-record page + iframe) and client-side
 * (dashboard). No grey text per house rule — bull / cyan-400 / sky-300 / white.
 */
export function TrackRecordEmbed({
  record,
  className,
}: {
  record: PublicTrackRecord;
  className?: string;
}) {
  const live = record.available;
  return (
    <EmbedFrame
      title="SPX Slayer Track Record"
      subtitle={live ? `${record.days_of_data}d logged` : "Standby"}
      variant="pulse"
      className={className}
      live={live}
    >
      <div className="p-5">
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <p className="font-mono text-[10px] tracking-[0.4em] text-bull uppercase mb-1">
              Hit Rate
            </p>
            <p className="font-anton text-5xl md:text-6xl text-white leading-none tabular-nums">
              {live ? `${record.win_rate_pct}%` : "——"}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-bold tabular-nums num-bull">
              {live ? record.total_closed : "—"}
            </p>
            <p className="font-mono text-[10px] text-sky-300 mt-1 uppercase tracking-widest">
              Closed Plays
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          <Stat label="Wins" value={live ? record.wins : "—"} tone="bull" />
          <Stat label="Losses" value={live ? record.losses : "—"} tone="bear" />
          <Stat label="Scratch" value={live ? record.breakeven : "—"} tone="sky" />
        </div>

        <div className="space-y-2">
          <PathRow
            label="Cold Buy"
            count={record.paths.cold_buy.count}
            winPct={record.paths.cold_buy.win_rate_pct}
            live={live}
          />
          <PathRow
            label="Watch → Promote"
            count={record.paths.watch_promote.count}
            winPct={record.paths.watch_promote.win_rate_pct}
            live={live}
          />
        </div>

        <p className="font-mono text-[10px] text-sky-300 mt-5 leading-relaxed">
          {live ? record.summary : "Play log warming up — closed trades populate as the desk grades them."}
        </p>
      </div>
    </EmbedFrame>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  // ReactNode (not number) so a fail-path can pass "—" — a PUBLIC social-proof
  // embed must never render a fabricated 0W/0L when no data is available.
  value: ReactNode;
  tone: "bull" | "bear" | "sky";
}) {
  return (
    <div className="rounded-md border border-border bg-black/40 px-3 py-2 text-center">
      <p
        className={clsx(
          "font-mono text-lg font-bold tabular-nums",
          tone === "bull" && "num-bull",
          tone === "bear" && "num-bear",
          tone === "sky" && "text-cyan-400"
        )}
      >
        {value}
      </p>
      <p className="font-mono text-[10px] text-sky-300 uppercase tracking-widest mt-0.5">
        {label}
      </p>
    </div>
  );
}

function PathRow({
  label,
  count,
  winPct,
  live,
}: {
  label: string;
  count: number;
  winPct: number;
  live: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
      <span className="font-mono text-[10px] tracking-widest uppercase text-sky-300">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums text-white">
        {live ? `${winPct}% · ${count}` : "—"}
      </span>
    </div>
  );
}
