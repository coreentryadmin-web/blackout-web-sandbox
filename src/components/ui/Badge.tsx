import { forwardRef } from "react";
import { clsx } from "clsx";

export type BadgeTone = "bull" | "bear" | "sky" | "neutral" | "accent";
export type BadgeSize = "sm" | "md";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Render a leading pulse dot (e.g. for LIVE / status pills). */
  dot?: boolean;
};

const TONE: Record<BadgeTone, string> = {
  bull: "border-bull/35 bg-bull/12 text-bull",
  bear: "border-bear/35 bg-bear/12 text-bear",
  // Non-grey neutral — sky-tinted, readable on the void.
  neutral: "border-sky-300/20 bg-sky-300/[0.06] text-sky-300",
  sky: "border-sky-400/35 bg-sky-400/12 text-sky-300",
  accent: "border-cyan-400/35 bg-cyan-400/12 text-cyan-300",
};

const DOT: Record<BadgeTone, string> = {
  bull: "bg-bull",
  bear: "bg-bear",
  neutral: "bg-sky-300",
  sky: "bg-sky-400",
  accent: "bg-cyan-400",
};

const SIZE: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-[11px]",
};

/**
 * Pill badge — tones bull / bear / sky / neutral / accent, sizes sm / md.
 * Mono, uppercase, wide tracking; optional leading pulse dot.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ tone = "neutral", size = "sm", dot = false, className, children, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full border font-mono font-semibold uppercase tracking-[0.14em] tabular-nums",
          TONE[tone],
          SIZE[size],
          className
        )}
        {...rest}
      >
        {dot && (
          <span
            aria-hidden
            className={clsx(
              "h-1.5 w-1.5 rounded-full animate-pulse motion-reduce:animate-none",
              DOT[tone]
            )}
          />
        )}
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";
