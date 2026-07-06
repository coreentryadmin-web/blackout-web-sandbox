import { forwardRef } from "react";
import { clsx } from "clsx";
import { Kicker } from "./Kicker";

type PageHeaderOwnProps = {
  /** Mono ◆ kicker line above the title. */
  kicker?: React.ReactNode;
  title: React.ReactNode;
  /** Accent fragment of the title, rendered with the brand gradient after `title`. */
  titleAccent?: React.ReactNode;
  /** Subtitle / lede under the title. */
  subtitle?: React.ReactNode;
  /** Badge slot, sits inline beside the title. */
  badge?: React.ReactNode;
  /** Right-aligned actions row. */
  actions?: React.ReactNode;
  className?: string;
};

export type PageHeaderProps = PageHeaderOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof PageHeaderOwnProps>;

/**
 * Page header — kicker + Anton title (with optional gradient accent), an optional
 * subtitle, an inline badge, and a right-aligned actions row. The standard top
 * block for an in-app tool page.
 */
export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(function PageHeader(
  { kicker, title, titleAccent, subtitle, badge, actions, className, ...rest },
  ref
) {
  return (
    <header
      ref={ref as React.Ref<HTMLElement>}
      className={clsx(
        "page-tool-header flex flex-wrap items-end justify-between gap-4",
        className
      )}
      {...rest}
    >
      <div className="min-w-0">
        {kicker != null && <Kicker className="mb-2">{kicker}</Kicker>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-syne text-2xl font-bold tracking-tight text-white md:text-3xl">
            {title}
            {titleAccent != null && (
              <>
                {" "}
                <span className="text-grad-brand">{titleAccent}</span>
              </>
            )}
          </h1>
          {badge != null && <span className="shrink-0">{badge}</span>}
        </div>
        {subtitle != null && (
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-secondary">{subtitle}</p>
        )}
      </div>
      {actions != null && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
});
