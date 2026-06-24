import { forwardRef } from "react";
import { clsx } from "clsx";

type PageShellOwnProps = {
  /** Render the ambient void backdrop. Defaults to true. */
  backdrop?: boolean;
  /** Custom backdrop node (overrides the default ambient glow). */
  backdropSlot?: React.ReactNode;
  /** Drop the centered .content-rail wrapper and render children full-bleed. */
  fullBleed?: boolean;
  /** Extra classes on the inner content area. */
  contentClassName?: string;
  className?: string;
  children?: React.ReactNode;
};

export type PageShellProps = PageShellOwnProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof PageShellOwnProps>;

/**
 * Standard in-app page frame — the canonical replacement for the hand-rolled
 * per-tool shells. Offsets the fixed nav via `--nav-offset`, paints an ambient
 * void backdrop behind the content, and centers the body in a `.content-rail`.
 *
 * Set `backdrop={false}` for tools that paint their own canvas, or pass
 * `backdropSlot` to supply a custom one.
 */
export const PageShell = forwardRef<HTMLDivElement, PageShellProps>(function PageShell(
  { backdrop = true, backdropSlot, fullBleed = false, contentClassName, className, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      id="main"
      className={clsx("relative min-h-[100svh] bg-void", className)}
      style={{ paddingTop: "var(--nav-offset)" }}
      {...rest}
    >
      {backdrop &&
        (backdropSlot ?? (
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 -z-10"
            style={{
              backgroundColor: "#040407",
              backgroundImage:
                "radial-gradient(ellipse 80% 60% at 50% -5%, rgba(0,230,118,0.13), transparent 55%)," +
                "radial-gradient(ellipse 50% 40% at 0% 50%, rgba(191,95,255,0.08), transparent 55%)," +
                "radial-gradient(ellipse 50% 40% at 100% 60%, rgba(255,45,85,0.06), transparent 55%)",
            }}
          />
        ))}
      <div
        className={clsx(
          !fullBleed && "content-rail",
          "relative z-10 py-6 md:py-8",
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
});
