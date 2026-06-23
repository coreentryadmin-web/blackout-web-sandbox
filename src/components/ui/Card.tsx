import { forwardRef } from "react";
import { clsx } from "clsx";

export type CardAccent = "none" | "bull" | "bear" | "sky" | "accent";

type CardOwnProps = {
  /** Accent border + glow tint. Defaults to "none" (plain glass). */
  accent?: CardAccent;
  /** Lift + emerald ring on hover. */
  hover?: boolean;
  /** Padding scale. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Polymorphic element / component to render as. Defaults to <div>. */
  as?: React.ElementType;
  className?: string;
  children?: React.ReactNode;
};

export type CardProps = CardOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof CardOwnProps>;

const ACCENT: Record<CardAccent, string> = {
  none: "border-white/10",
  bull: "border-bull/35 shadow-[0_0_50px_-30px_rgba(0,230,118,0.6)]",
  bear: "border-bear/35 shadow-[0_0_50px_-30px_rgba(255,45,85,0.6)]",
  sky: "border-sky-400/30 shadow-[0_0_50px_-30px_rgba(56,189,248,0.5)]",
  accent: "border-cyan-400/30 shadow-[0_0_50px_-30px_rgba(34,211,238,0.5)]",
};

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-5 md:p-6",
  lg: "p-6 md:p-8",
} as const;

/**
 * Glass surface card — the house glassmorphism look
 * (translucent void fill, backdrop blur, hairline border, rounded-2xl).
 *
 * Optional accent border/glow + hover lift. Polymorphic via `as`.
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { accent = "none", hover = false, padding = "md", as, className, children, ...rest },
  ref
) {
  const Comp = (as ?? "div") as React.ElementType;
  return (
    <Comp
      ref={ref}
      className={clsx(
        "rounded-2xl border bg-[rgba(8,9,14,0.6)] backdrop-blur",
        ACCENT[accent],
        PADDING[padding],
        hover &&
          "transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 " +
            "hover:border-bull/40 hover:shadow-[0_0_0_1px_rgba(0,230,118,0.2),0_18px_50px_-24px_rgba(0,0,0,0.8)] " +
            "motion-reduce:hover:translate-y-0",
        className
      )}
      {...rest}
    >
      {children}
    </Comp>
  );
});
