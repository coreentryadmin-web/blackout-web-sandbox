"use client";

import { useId, useState } from "react";
import { clsx } from "clsx";

export type CollapsibleTileProps = {
  id?: string;
  title: string;
  kicker?: string;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "default" | "accent" | "gold";
  /** When true, header is not interactive and body stays visible. */
  static?: boolean;
  className?: string;
  children: React.ReactNode;
};

const VARIANT_CLASS: Record<NonNullable<CollapsibleTileProps["variant"]>, string> = {
  default: "",
  accent: "nighthawk-tile-accent",
  gold: "nighthawk-tile-gold",
};

export function CollapsibleTile({
  id,
  title,
  kicker,
  badge,
  meta,
  defaultOpen = true,
  open,
  onOpenChange,
  variant = "default",
  static: isStatic = false,
  className,
  children,
}: CollapsibleTileProps) {
  const generatedId = useId();
  const panelId = id ?? generatedId;
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = isStatic ? true : isControlled ? open : internalOpen;

  function toggle() {
    if (isStatic) return;
    const next = !isOpen;
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  }

  const headerInner = (
    <>
      <div className="nighthawk-tile-header-text min-w-0 flex-1">
        {kicker ? <span className="nighthawk-tile-kicker">{kicker}</span> : null}
        <span className="nighthawk-tile-title">{title}</span>
        {meta ? <span className="nighthawk-tile-meta">{meta}</span> : null}
      </div>
      {badge != null ? (
        typeof badge === "string" || typeof badge === "number" ? (
          <span className="nighthawk-tile-badge">{badge}</span>
        ) : (
          <span className="nighthawk-tile-badge-slot">{badge}</span>
        )
      ) : null}
      {!isStatic ? (
        <span className="nighthawk-tile-chevron" aria-hidden>
          ▾
        </span>
      ) : null}
    </>
  );

  return (
    <section className={clsx("nighthawk-tile", VARIANT_CLASS[variant], className)}>
      {isStatic ? (
        <div className="nighthawk-tile-header nighthawk-tile-header-static">{headerInner}</div>
      ) : (
        <button
          type="button"
          className="nighthawk-tile-header"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={toggle}
        >
          {headerInner}
        </button>
      )}

      <div
        id={panelId}
        className={clsx("nighthawk-tile-body", isOpen && "nighthawk-tile-body-open")}
        aria-hidden={!isOpen}
      >
        <div className="nighthawk-tile-inner">
          <div className="nighthawk-tile-content">{children}</div>
        </div>
      </div>
    </section>
  );
}
