import { forwardRef } from "react";
import Link from "next/link";
import { clsx } from "clsx";

export type ButtonVariant = "primary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show a spinner and disable interaction. */
  loading?: boolean;
  /** Stretch to fill the container width. */
  block?: boolean;
  children?: React.ReactNode;
  className?: string;
};

type ButtonAsButton = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps | "href"> & {
    as?: "button";
    href?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & {
    /** Provide an href to render a Next.js <Link> (or a plain <a> when external). */
    href: string;
    /** Render a plain external anchor (target=_blank, rel=noopener) instead of <Link>. */
    external?: boolean;
    disabled?: boolean;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const BASE =
  "relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl font-semibold tracking-[0.01em] " +
  // Transform + border-color + opacity only — NO box-shadow/background repaint
  // on the transition (the hover glow is pre-rendered on ::after, revealed by
  // opacity). VITALS tempo: --dur-base + --ease-snap.
  "transition-[transform,border-color,opacity] duration-base ease-snap " +
  "select-none whitespace-nowrap " +
  "hover:scale-[1.02] active:scale-[0.98] motion-reduce:hover:scale-100 motion-reduce:active:scale-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-void " +
  "disabled:pointer-events-none disabled:opacity-50";

/**
 * Emerald Sweep (VITALS micro-interaction) — applied to the CTA variants.
 *
 * Idle cost ZERO; both pseudo-elements only animate on hover/focus.
 *
 *  ::after — a PRE-RENDERED emerald glow ring, revealed by opacity 0→1 (no
 *            box-shadow tween on the hover loop — opacity-only, cheap).
 *  ::before — an emerald light bar that SWEEPS across once on hover, reusing
 *            the existing footer-sheen keyframe (translateX + skewX = transform-
 *            only). Clipped by the button's overflow-hidden.
 *
 * Reduced-motion: the sheen ::before is hidden (motion-reduce:before:hidden);
 * the glow ::after still fades in via opacity (the global @media block collapses
 * its duration to instant, so it simply appears — no meaning lost). The scale /
 * press transforms are already gated by the motion-reduce utilities in BASE.
 */
const EMERALD_SWEEP =
  // ::after — pre-rendered glow, opacity-revealed on hover + focus-visible.
  "after:content-[''] before:content-[''] " +
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:opacity-0 " +
  "after:shadow-[0_0_42px_-6px_rgba(0,230,118,0.85),inset_0_0_18px_-8px_rgba(0,230,118,0.6)] " +
  "after:transition-opacity after:duration-fast after:ease-draw " +
  "hover:after:opacity-100 focus-visible:after:opacity-100 " +
  // ::before — emerald sheen bar; starts off-screen left, sweeps on hover only.
  "before:pointer-events-none before:absolute before:inset-y-0 before:-left-1/3 before:w-1/3 " +
  "before:-translate-x-[120%] before:skew-x-[-18deg] before:opacity-0 " +
  "before:bg-gradient-to-r before:from-transparent before:via-bull/35 before:to-transparent " +
  "hover:before:opacity-100 hover:before:animate-[footer-sheen_0.7s_var(--ease-sweep)] " +
  "focus-visible:before:opacity-100 focus-visible:before:animate-[footer-sheen_0.7s_var(--ease-sweep)] " +
  "motion-reduce:before:hidden";

const VARIANT: Record<ButtonVariant, string> = {
  // Emerald fill, dark text — the signature CTA. Resting glow is a static
  // shadow (no loop); the HOVER box-shadow swap is retired in favour of the
  // pre-rendered ::after glow from EMERALD_SWEEP.
  primary:
    "bg-gradient-to-b from-bull to-[#0f9d58] text-[#021c14] border border-bull/40 " +
    "shadow-[0_0_30px_-10px_rgba(0,230,118,0.6)] " +
    EMERALD_SWEEP,
  ghost: "bg-white/[0.04] text-white border border-white/10 hover:bg-white/[0.08] hover:border-white/20",
  outline:
    "bg-bull/[0.06] text-bull border border-bull/40 hover:bg-bull/[0.12] hover:border-bull/60 " +
    EMERALD_SWEEP,
  danger:
    "bg-bear/[0.12] text-bear border border-bear/45 hover:bg-bear/[0.2] hover:border-bear/70 " +
    "shadow-[0_0_24px_-12px_rgba(255,45,85,0.6)]",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-11 px-6 text-[14px]",
};

const SPINNER_TONE: Record<ButtonVariant, string> = {
  primary: "text-[#021c14]",
  ghost: "text-white",
  outline: "text-bull",
  danger: "text-bear",
};

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none",
        className
      )}
    />
  );
}

/**
 * The shared CTA / action button.
 *
 * Variants: primary (emerald fill, dark text) · ghost · outline (emerald) · danger (bear).
 * Sizes: sm / md. Supports loading + disabled states.
 * Polymorphic: renders <button> by default, or a Next.js <Link> / external <a> when given `href`.
 */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = "primary",
      size = "md",
      loading = false,
      block = false,
      className,
      children,
    } = props;

    const classes = clsx(BASE, VARIANT[variant], SIZE[size], block && "w-full", className);

    const content = (
      // z-10 keeps the label above the Emerald Sweep ::before/::after pseudos.
      <span className="relative z-10 inline-flex items-center gap-2">
        {loading && <Spinner className={SPINNER_TONE[variant]} />}
        <span className={clsx(loading && "opacity-90")}>{children}</span>
      </span>
    );

    if ("href" in props && props.href != null) {
      // Pull every owned prop out so only DOM-valid anchor attrs land on the node.
      const {
        href,
        external,
        disabled,
        variant: _v,
        size: _s,
        loading: _l,
        block: _b,
        className: _c,
        children: _ch,
        ...rest
      } = props as ButtonAsLink;

      const isInert = disabled || loading;
      const anchorProps = {
        ...rest,
        ref: ref as React.Ref<HTMLAnchorElement>,
        className: clsx(classes, isInert && "pointer-events-none opacity-50"),
        "aria-disabled": isInert || undefined,
        tabIndex: isInert ? -1 : rest.tabIndex,
      };

      if (external) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...anchorProps}>
            {content}
          </a>
        );
      }
      return (
        <Link href={href} {...anchorProps}>
          {content}
        </Link>
      );
    }

    const {
      type = "button",
      disabled,
      as: _as,
      variant: _v,
      size: _s,
      loading: _l,
      block: _b,
      className: _c,
      children: _ch,
      ...rest
    } = props as ButtonAsButton;

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={classes}
        {...rest}
      >
        {content}
      </button>
    );
  }
);
