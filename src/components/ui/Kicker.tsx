import { forwardRef } from "react";
import { clsx } from "clsx";

export type KickerProps = React.HTMLAttributes<HTMLParagraphElement> & {
  /** Show the leading ◆ sigil. Defaults to false (premium/minimal). */
  sigil?: boolean;
};

/**
 * The house mono kicker line — JetBrains mono, uppercase, wide tracking, emerald.
 * Renders an optional leading ◆ sigil when `sigil` is true.
 *
 * Uses the `.t-kicker` type class (font-mono, 10px floor, tracking-[0.35em], text-bull).
 */
export const Kicker = forwardRef<HTMLParagraphElement, KickerProps>(
  ({ sigil = false, className, children, ...rest }, ref) => {
    return (
      <p ref={ref} className={clsx("t-kicker flex items-center gap-2", className)} {...rest}>
        {sigil && (
          <span aria-hidden className="text-bull/80 leading-none">
            ◆
          </span>
        )}
        {children}
      </p>
    );
  }
);

Kicker.displayName = "Kicker";
