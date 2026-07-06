import { clsx } from "clsx";

type DeskShellProps = {
  children: React.ReactNode;
  /** Match flows/heatmap edge padding instead of the centered content rail. */
  fullBleed?: boolean;
  className?: string;
};

/** Shared desk route chrome — nav offset + horizontal padding without hero art. */
export function DeskShell({ children, fullBleed, className }: DeskShellProps) {
  return (
    <div
      className={clsx(
        "relative w-full pb-8 ios-desk-shell",
        fullBleed
          ? "max-w-none px-2 sm:px-3 lg:px-4 xl:px-5"
          : "content-rail mx-auto w-full",
        className
      )}
      style={{ paddingTop: "var(--nav-offset)", paddingBottom: "calc(2rem + var(--ios-tab-offset, 0px))" }}
    >
      {children}
    </div>
  );
}
