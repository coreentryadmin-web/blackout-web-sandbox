"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";

export type FreshnessStatus = "live" | "stale" | "cached" | "offline" | "syncing";

export type FreshnessChipProps = {
  status: FreshnessStatus;
  /** When the underlying data was last successfully fetched or generated. */
  asOf?: Date | null;
  /** Optional override for the status word (e.g. "Cached snapshot"). */
  label?: string;
  className?: string;
};

const STATUS_LABEL: Record<FreshnessStatus, string> = {
  live: "Live",
  stale: "Stale",
  cached: "Cached",
  offline: "Offline",
  syncing: "Syncing",
};

const STATUS_TONE: Record<FreshnessStatus, string> = {
  live: "border-bull/35 bg-bull/10 text-bull",
  stale: "border-gold/35 bg-gold/10 text-gold",
  cached: "border-gold/35 bg-gold/10 text-gold",
  offline: "border-bear/35 bg-bear/10 text-bear-text",
  syncing: "border-sky-400/30 bg-sky-400/10 text-sky-300",
};

const DOT_TONE: Record<FreshnessStatus, string> = {
  live: "bg-bull",
  stale: "bg-gold",
  cached: "bg-gold",
  offline: "bg-bear-text",
  syncing: "bg-sky-400 animate-pulse motion-reduce:animate-none",
};

function formatAge(from: Date, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - from.getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/**
 * Honest data-freshness indicator — status word + optional age since `asOf`.
 * Replaces misleading always-green "Live" badges on marketing/desk surfaces.
 */
export function FreshnessChip({ status, asOf, label, className }: FreshnessChipProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status === "syncing" || !asOf) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, asOf]);

  const word = label ?? STATUS_LABEL[status];
  const age =
    asOf && status !== "syncing" && status !== "offline"
      ? formatAge(asOf, now)
      : null;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] tabular-nums",
        STATUS_TONE[status],
        className
      )}
      title={asOf ? `Last updated ${asOf.toLocaleString()}` : undefined}
    >
      <span
        aria-hidden
        className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", DOT_TONE[status])}
      />
      <span>
        {word}
        {age != null ? ` · ${age}` : null}
      </span>
    </span>
  );
}
