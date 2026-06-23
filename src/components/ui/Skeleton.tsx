import { forwardRef } from "react";
import { clsx } from "clsx";

type Dimension = number | string;

type SkeletonOwnProps = {
  width?: Dimension;
  height?: Dimension;
  /** Corner radius — a token or any CSS length. Defaults to "lg". */
  rounded?: "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "full" | (string & {});
  /** Render as a circle (width drives the diameter). */
  circle?: boolean;
  className?: string;
};

export type SkeletonProps = SkeletonOwnProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof SkeletonOwnProps | "children">;

const ROUNDED: Record<string, string> = {
  none: "0px",
  sm: "0.125rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
  "2xl": "1rem",
  full: "9999px",
};

function dim(v: Dimension | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === "number" ? `${v}px` : v;
}

/**
 * Shimmer placeholder block — an emerald sweep over a translucent base.
 * Reduced-motion gated (the sweep is disabled, the block stays as a static tint).
 *
 * The sweep relies on the `ui-skeleton` keyframe in globals.css.
 */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { width, height, rounded = "lg", circle = false, className, style, ...rest },
  ref
) {
  const radius = circle ? "9999px" : ROUNDED[rounded as string] ?? (rounded as string);
  const resolvedWidth = dim(width);
  const resolvedHeight = circle ? resolvedWidth ?? dim(height) : dim(height);

  return (
    <div
      ref={ref}
      aria-hidden
      className={clsx(
        "relative overflow-hidden bg-white/[0.05]",
        // The emerald sweep; turned off under reduced-motion.
        "before:absolute before:inset-0 before:-translate-x-full " +
          "before:bg-gradient-to-r before:from-transparent before:via-bull/15 before:to-transparent " +
          "before:[animation:ui-skeleton_1.6s_ease-in-out_infinite] " +
          "motion-reduce:before:hidden",
        className
      )}
      style={{
        width: resolvedWidth,
        height: resolvedHeight,
        borderRadius: radius,
        ...style,
      }}
      {...rest}
    />
  );
});
