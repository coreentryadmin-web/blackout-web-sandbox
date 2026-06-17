"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";

type EmbedFrameProps = {
  title: string;
  subtitle?: string;
  variant?: "tv" | "pulse" | "flow" | "thermal" | "radar" | "ai";
  className?: string;
  children: ReactNode;
  live?: boolean;
};

const VARIANT_BORDER: Record<NonNullable<EmbedFrameProps["variant"]>, string> = {
  tv: "border-bull/30 shadow-glow-bull",
  pulse: "border-bull/25",
  flow: "border-purple/35 shadow-glow-purple",
  thermal: "border-bear/25",
  radar: "border-bear/40 shadow-glow-bear",
  ai: "border-purple/40 shadow-glow-purple",
};

export function EmbedFrame({
  title,
  subtitle,
  variant = "tv",
  className,
  children,
  live = true,
}: EmbedFrameProps) {
  return (
    <div
      className={clsx(
        "embed-frame relative overflow-hidden bg-black/80 border scan-line",
        VARIANT_BORDER[variant],
        className
      )}
    >
      <div className="embed-frame-header">
        <div className="flex items-center gap-2 min-w-0">
          <span className="embed-frame-dot" />
          <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-grey-200 truncate">
            {title}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {subtitle && (
            <span className="font-mono text-[9px] text-grey-400 uppercase tracking-widest hidden sm:inline">
              {subtitle}
            </span>
          )}
          {live && (
            <span className="badge-live text-[9px]">
              <span className="badge-live-dot" />
              Live
            </span>
          )}
        </div>
      </div>
      <div className="embed-frame-body">{children}</div>
      <div className="embed-frame-corners" aria-hidden />
    </div>
  );
}
