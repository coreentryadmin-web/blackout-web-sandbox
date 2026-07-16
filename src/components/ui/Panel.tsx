import { forwardRef } from "react";
import { clsx } from "clsx";
import { Kicker } from "./Kicker";

export type PanelAccent = "bull" | "bear" | "sky" | "accent" | "ember" | "purple" | "gold";

const ACCENT_BORDER: Record<PanelAccent, string> = {
  bull: "border-bull/30",
  bear: "border-bear/30",
  sky: "border-sky-400/25",
  accent: "border-cyan-400/25",
  ember: "border-ember/30",
  purple: "border-purple-400/25",
  gold: "border-yellow-400/25",
};

// Top hairline strip that signals the panel's accent.
const ACCENT_STRIP: Record<PanelAccent, string> = {
  bull: "from-transparent via-bull to-transparent shadow-[0_0_18px_#00e676]",
  bear: "from-transparent via-bear to-transparent shadow-[0_0_18px_#ff2d55]",
  sky: "from-transparent via-sky-400 to-transparent shadow-[0_0_18px_#38bdf8]",
  accent: "from-transparent via-cyan-400 to-transparent shadow-[0_0_18px_#22d3ee]",
  ember: "from-transparent via-ember to-transparent shadow-[0_0_18px_#ff6b2b]",
  purple: "from-transparent via-purple-400 to-transparent shadow-[0_0_18px_#a78bfa]",
  gold: "from-transparent via-yellow-400 to-transparent shadow-[0_0_18px_#facc15]",
};

export type PanelHeaderProps = Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  /** Mono ◆ kicker line above the title. */
  kicker?: React.ReactNode;
  title?: React.ReactNode;
  /** Right-aligned actions slot (buttons, badges, toggles). */
  actions?: React.ReactNode;
};

/**
 * Panel header — kicker + Syne title on the left, actions on the right,
 * with a hairline divider below. Use standalone or via <Panel header>.
 */
export const PanelHeader = forwardRef<HTMLDivElement, PanelHeaderProps>(function PanelHeader(
  { kicker, title, actions, className, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={clsx(
        "flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6",
        className
      )}
      {...rest}
    >
      <div className="min-w-0">
        {kicker != null && <Kicker className="mb-1.5">{kicker}</Kicker>}
        {title != null && (
          <h3 className="t-label text-[15px] uppercase leading-tight text-white">{title}</h3>
        )}
        {children}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
});

type PanelOwnProps = {
  /** Mono ◆ kicker line above the title (shorthand for a built-in header). */
  kicker?: React.ReactNode;
  title?: React.ReactNode;
  /** Right-aligned header actions slot. */
  actions?: React.ReactNode;
  /** Provide a fully custom header node instead of kicker/title/actions. */
  header?: React.ReactNode;
  accent?: PanelAccent;
  /** Render the glowing accent strip across the top. Defaults to true. */
  strip?: boolean;
  /** Padding applied to the body. */
  bodyClassName?: string;
  className?: string;
  children?: React.ReactNode;
};

export type PanelProps = PanelOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof PanelOwnProps>;

/**
 * Titled desk panel — the canonical replacement for the bespoke spx / flow / admin
 * panels. Glass surface, accent top-strip, a header slot (kicker + title + actions)
 * and a body. Pass either the kicker/title/actions shorthands or a custom `header`.
 */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  {
    kicker,
    title,
    actions,
    header,
    accent = "bull",
    strip = true,
    bodyClassName,
    className,
    children,
    ...rest
  },
  ref
) {
  const hasHeader = header != null || kicker != null || title != null || actions != null;

  return (
    <section
      ref={ref as React.Ref<HTMLElement>}
      className={clsx(
        "desk-panel relative overflow-hidden rounded-2xl border backdrop-blur",
        ACCENT_BORDER[accent],
        className
      )}
      {...rest}
    >
      {strip && (
        <span
          aria-hidden
          className={clsx(
            "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r",
            ACCENT_STRIP[accent]
          )}
        />
      )}
      {hasHeader &&
        (header != null ? (
          header
        ) : (
          <PanelHeader kicker={kicker} title={title} actions={actions} />
        ))}
      <div className={clsx("px-5 py-4 md:px-6 md:py-5", bodyClassName)}>{children}</div>
    </section>
  );
});
