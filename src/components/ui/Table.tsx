import { forwardRef } from "react";
import { clsx } from "clsx";

/**
 * Thin styled table shell — the brand row dividers (hairline white/10) + hover.
 * Use the compound parts directly:
 *
 *   <Table>
 *     <THead><TR><TH>Strike</TH><TH align="right">Prem</TH></TR></THead>
 *     <TBody>
 *       <TR><TD>5500C</TD><TD align="right" tone="bull">+1.2M</TD></TR>
 *     </TBody>
 *   </Table>
 *
 * Table wraps the <table> in a scroll container so wide desks scroll horizontally.
 */

type TableOwnProps = {
  /** Constrain height + enable vertical scroll. */
  scroll?: boolean;
  className?: string;
  /** className for the inner <table> element. */
  tableClassName?: string;
  children?: React.ReactNode;
};

export type TableProps = TableOwnProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof TableOwnProps>;

export const Table = forwardRef<HTMLDivElement, TableProps>(function Table(
  { scroll = false, className, tableClassName, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={clsx(
        "w-full overflow-x-auto rounded-xl border border-white/10 bg-[rgba(8,9,14,0.4)]",
        scroll && "max-h-[60vh] overflow-y-auto",
        className
      )}
      {...rest}
    >
      <table className={clsx("w-full border-collapse text-left", tableClassName)}>{children}</table>
    </div>
  );
});

export type THeadProps = React.HTMLAttributes<HTMLTableSectionElement>;

export const THead = forwardRef<HTMLTableSectionElement, THeadProps>(function THead(
  { className, children, ...rest },
  ref
) {
  return (
    <thead
      ref={ref}
      className={clsx(
        "sticky top-0 z-10 bg-[rgba(8,9,14,0.92)] backdrop-blur [&_tr]:border-b [&_tr]:border-white/10",
        className
      )}
      {...rest}
    >
      {children}
    </thead>
  );
});

export type TBodyProps = React.HTMLAttributes<HTMLTableSectionElement>;

export const TBody = forwardRef<HTMLTableSectionElement, TBodyProps>(function TBody(
  { className, children, ...rest },
  ref
) {
  return (
    <tbody
      ref={ref}
      className={clsx(
        "[&_tr]:border-b [&_tr]:border-white/[0.06] [&_tr:last-child]:border-0 " +
          "[&_tr]:transition-colors [&_tr:hover]:bg-bull/[0.05]",
        className
      )}
      {...rest}
    >
      {children}
    </tbody>
  );
});

export type TRProps = React.HTMLAttributes<HTMLTableRowElement>;

export const TR = forwardRef<HTMLTableRowElement, TRProps>(function TR(
  { className, children, ...rest },
  ref
) {
  return (
    <tr ref={ref} className={className} {...rest}>
      {children}
    </tr>
  );
});

type CellAlign = "left" | "right" | "center";
const ALIGN: Record<CellAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export type THProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  align?: CellAlign;
};

export const TH = forwardRef<HTMLTableCellElement, THProps>(function TH(
  { align = "left", className, children, ...rest },
  ref
) {
  return (
    <th
      ref={ref}
      scope="col"
      className={clsx(
        "px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9fb4d4]",
        ALIGN[align],
        className
      )}
      {...rest}
    >
      {children}
    </th>
  );
});

type CellTone = "bull" | "bear" | "sky" | "accent" | "default";
const CELL_TONE: Record<CellTone, string> = {
  bull: "text-bull",
  bear: "text-bear",
  sky: "text-sky-300",
  accent: "text-cyan-300",
  default: "text-white/90",
};

export type TDProps = React.TdHTMLAttributes<HTMLTableCellElement> & {
  align?: CellAlign;
  tone?: CellTone;
  /** Render value as mono tabular nums. */
  num?: boolean;
};

export const TD = forwardRef<HTMLTableCellElement, TDProps>(function TD(
  { align = "left", tone = "default", num = false, className, children, ...rest },
  ref
) {
  return (
    <td
      ref={ref}
      className={clsx(
        "px-3 py-2.5 text-[13px]",
        ALIGN[align],
        CELL_TONE[tone],
        num && "t-num tabular-nums",
        className
      )}
      {...rest}
    >
      {children}
    </td>
  );
});
