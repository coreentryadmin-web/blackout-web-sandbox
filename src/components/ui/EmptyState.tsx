import { forwardRef } from "react";
import { clsx } from "clsx";

type EmptyStateOwnProps = {
  /** Icon / sigil slot — an SVG, emoji, or the brand ◆. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional action slot (typically a <Button>). */
  action?: React.ReactNode;
  className?: string;
};

export type EmptyStateProps = EmptyStateOwnProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof EmptyStateOwnProps>;

/**
 * The one shared empty state — centered sigil/icon, title, description, optional action.
 * Glass-tinted, dashed hairline border to read as a placeholder rather than a card.
 */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, description, action, className, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={clsx(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/12 " +
          "bg-[rgba(8,9,14,0.4)] px-6 py-12 text-center",
        className
      )}
      {...rest}
    >
      {icon != null && (
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-bull/25 bg-bull/[0.08] text-2xl text-bull">
          {icon}
        </div>
      )}
      <h3 className="t-label text-[15px] uppercase text-white">{title}</h3>
      {description != null && (
        <p className="max-w-sm text-[13px] leading-relaxed text-sky-300/70">{description}</p>
      )}
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  );
});
