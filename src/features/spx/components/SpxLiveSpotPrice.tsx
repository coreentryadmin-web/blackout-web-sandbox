"use client";

import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { fmtPct, fmtPrice } from "@/lib/api";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  /** hero = former header size; panel = above play engine */
  size?: "hero" | "panel";
  className?: string;
};

export function SpxLiveSpotPrice({ desk, live, size = "panel", className }: Props) {
  const hasQuote = Boolean(desk?.available && (desk?.price ?? 0) > 0);
  const showValues = Boolean(live || hasQuote);
  const bull = (desk?.spx_change_pct ?? 0) >= 0;

  return (
    <div className={clsx("spx-live-spot-price", size === "panel" && "spx-live-spot-price-panel", className)}>
      <p
        className={clsx(
          "spx-hero-price t-num font-semibold leading-none",
          size === "hero"
            ? "text-6xl sm:text-7xl md:text-8xl"
            : "text-5xl sm:text-6xl",
          bull ? "text-bull" : "text-bear-text"
        )}
      >
        {showValues ? fmtPrice(desk?.price ?? null, 2) : "—"}
      </p>
      {!live && hasQuote && (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-sky-300">
          Last session snapshot · not live
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span
          className={clsx(
            "t-num text-sm font-semibold sm:text-base",
            bull ? "text-bull" : "text-bear-text"
          )}
        >
          {showValues ? fmtPct(desk?.spx_change_pct ?? null) : "—"}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-secondary">SPX spot</span>
      </div>
    </div>
  );
}

/** ▲ when spot is above the level, ▼ when below. */
export function priceVsLevel(
  spot: number | null | undefined,
  level: number | null | undefined
): "up" | "down" | null {
  if (spot == null || level == null || !Number.isFinite(spot) || !Number.isFinite(level)) return null;
  if (spot > level) return "up";
  if (spot < level) return "down";
  return null;
}

export function PriceLevelIndicator({ direction }: { direction: "up" | "down" | null }) {
  if (!direction) {
    return <span className="spx-price-level-indicator spx-price-level-indicator-flat" aria-hidden>·</span>;
  }
  return (
    <span
      className={clsx(
        "spx-price-level-indicator",
        direction === "up" ? "spx-price-level-indicator-up" : "spx-price-level-indicator-down"
      )}
      aria-label={direction === "up" ? "Spot above level" : "Spot below level"}
    >
      {direction === "up" ? "▲" : "▼"}
    </span>
  );
}
