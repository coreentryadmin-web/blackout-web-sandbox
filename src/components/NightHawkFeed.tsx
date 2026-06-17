"use client";

import useSWR from "swr";
import { fetchNightHawkPlays, fmtPremium, type NightHawkPlay } from "@/lib/api";
import { clsx } from "clsx";
import { PlatformEmpty } from "@/components/platform/PlatformEmpty";
import { NightHawkEmbeds } from "@/components/embeds/NightHawkEmbeds";

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#888";
  return (
    <div className="w-full bg-surface-2 h-1 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function PlayCard({ play }: { play: NightHawkPlay }) {
  const isBull = play.direction === "bullish" || play.direction === "long";
  return (
    <div className="card p-6 hover:bg-surface-1 transition-colors space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xl font-bold text-white">{play.ticker}</span>
            <span className={clsx("text-[10px] tracking-[2px] uppercase px-2 py-0.5 border", isBull ? "border-green-900/50 text-bull" : "border-red-900/50 text-bear")}>
              {play.direction}
            </span>
          </div>
          <p className="text-[11px] text-text-muted mt-1">{play.dte_range} DTE · Entry {fmtPremium(play.entry_premium)}</p>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl text-white tracking-[1px]">{play.score.toFixed(0)}</div>
          <div className="text-[10px] text-text-muted uppercase tracking-[1px]">Score</div>
        </div>
      </div>

      <ScoreBar score={play.score} />

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] tracking-[1px] uppercase text-text-muted mb-1">Flow Streak</p>
          <p className="font-mono text-[13px] text-text-primary">{play.streak_days}d</p>
        </div>
        <div>
          <p className="text-[10px] tracking-[1px] uppercase text-text-muted mb-1">IV Rank</p>
          <p className={clsx("font-mono text-[13px]", play.iv_rank > 70 ? "num-bear" : "text-text-primary")}>
            {play.iv_rank}
          </p>
        </div>
        <div>
          <p className="text-[10px] tracking-[1px] uppercase text-text-muted mb-1">Posted</p>
          <p className="font-mono text-[12px] text-text-muted">
            {play.posted_at ? new Date(play.posted_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}
          </p>
        </div>
      </div>

      {play.summary && (
        <p className="text-[13px] text-text-secondary leading-relaxed border-t border-surface-2 pt-4">
          {play.summary}
        </p>
      )}
    </div>
  );
}

export function NightHawkFeed() {
  const { data, isLoading } = useSWR("nighthawk", fetchNightHawkPlays, { refreshInterval: 60_000 });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <NightHawkEmbeds />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-surface-1 h-48" />)}
        </div>
      </div>
    );
  }

  const plays = data?.plays ?? [];

  if (plays.length === 0) {
    return (
      <div className="space-y-6">
        <NightHawkEmbeds />
        <PlatformEmpty
        variant="nighthawk"
        title="NO ACTIVE PLAYS"
        description="Night Hawk scans every 20 minutes during RTH (9:30 AM – 4:00 PM ET). Swing dossiers drop when setups qualify."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <NightHawkEmbeds />
      <p className="text-[10px] tracking-[2px] text-text-muted uppercase">{plays.length} active play{plays.length !== 1 ? "s" : ""}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plays.map((p, i) => <PlayCard key={`${p.ticker}-${p.posted_at}-${i}`} play={p} />)}
      </div>
    </div>
  );
}
