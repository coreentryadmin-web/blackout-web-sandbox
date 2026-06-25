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
 * Live Border + Focus Ignite (VITALS micro-interaction) — applied to the `hover`
 * (interactive) card variant. Idle cost ZERO; the ring only fades in on
 * hover / focus-within / focus-visible.
 *
 *  ::after — a PRE-RENDERED hairline emerald ring + soft outer glow, revealed by
 *            opacity 0→1 (no box-shadow tween on the hover loop — opacity-only).
 *            `focus-within` lights it for mouse-and-keyboard a11y parity;
 *            `focus-visible` adds the keyboard "ignite" ring.
 *
 * Reduced-motion: the ring STILL appears (opacity), the global @media block just
 * collapses the fade to instant — WCAG 2.4.7 focus visibility is never sacrificed
 * to a motion preference. The hover lift transform is already motion-reduce gated.
 *
 * `relative` is added only under `hover`, so plain static cards (and any absolutely
 * positioned children they own) are completely untouched.
 */
const LIVE_BORDER =
  "relative transition-transform duration-base ease-draw hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 " +
  "after:content-[''] after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:opacity-0 " +
  "after:shadow-[inset_0_0_0_1px_rgba(0,230,118,0.45),0_0_38px_-10px_rgba(0,230,118,0.55),0_18px_50px_-24px_rgba(0,0,0,0.85)] " +
  "after:transition-opacity after:duration-base after:ease-draw " +
  "hover:after:opacity-100 focus-within:after:opacity-100 focus-visible:after:opacity-100";

/**
 * Glass surface card — the house glassmorphism look
 * (translucent void fill, backdrop blur, hairline border, rounded-2xl).
 *
 * Optional accent border/glow + hover lift + live-border ring. Polymorphic via `as`.
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
        hover && LIVE_BORDER,
        className
      )}
      {...rest}
    >
      {children}
    </Comp>
  );
});
