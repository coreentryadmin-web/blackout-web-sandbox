"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { useFocusTrap } from "./useFocusTrap";

export type ModalSide = "center" | "right" | "left";
export type ModalSize = "sm" | "md" | "lg";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  /** Accessible label for the dialog (used as aria-label when no title node). */
  title?: React.ReactNode;
  /** Layout: centered modal (default) or a slide-in drawer from a side. */
  side?: ModalSide;
  size?: ModalSize;
  /** Click on the scrim closes the dialog. Defaults to true. */
  closeOnScrim?: boolean;
  /** Esc closes the dialog. Defaults to true. */
  closeOnEsc?: boolean;
  /** Render an X close affordance in the header row. Defaults to true. */
  showClose?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const SIZE: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

const DRAWER_SIZE: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
};

/**
 * Accessible dialog — role="dialog" aria-modal, scrim (click-to-close), Esc-to-close,
 * a manual focus trap (no extra dependency), body scroll-lock while open, and
 * framer enter/exit. `side` switches between a centered modal and a slide-in drawer.
 *
 * Focus-trap approach: on open we record document.activeElement (the opener), move
 * focus to the first focusable node inside the panel, and intercept Tab/Shift+Tab to
 * wrap focus at the panel's edges (querying the live focusable set on each keypress).
 * On close we restore focus to the opener.
 */
export function Modal({
  open,
  onClose,
  title,
  side = "center",
  size = "md",
  closeOnScrim = true,
  closeOnEsc = true,
  showClose = true,
  className,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const isDrawer = side !== "center";

  // Focus trap, scroll-lock, Esc, and return-focus — shared with the other
  // hand-rolled dialogs. When closeOnEsc is false we pass no onEscape so Esc is
  // ignored entirely (matching the original inline behaviour).
  useFocusTrap(panelRef, { active: open, onEscape: closeOnEsc ? onClose : undefined });

  // Portal target — guard for SSR.
  if (typeof document === "undefined") return null;

  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const panelInitial = reduce
    ? { opacity: 0 }
    : isDrawer
      ? { opacity: 1, x: side === "right" ? "100%" : "-100%" }
      : { opacity: 0, y: 16, scale: 0.98 };
  const panelAnimate = isDrawer ? { opacity: 1, x: 0 } : { opacity: 1, y: 0, scale: 1 };
  const panelExit = panelInitial;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={clsx(
            "fixed inset-0 z-[100] flex",
            isDrawer
              ? side === "right"
                ? "justify-end"
                : "justify-start"
              : "items-center justify-center p-4"
          )}
        >
          {/* scrim */}
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={closeOnScrim ? onClose : undefined}
          />

          {/* panel */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            aria-labelledby={typeof title === "string" ? undefined : title != null ? labelId : undefined}
            tabIndex={-1}
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelExit}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.4, 0, 0.2, 1] }}
            className={clsx(
              "relative z-10 flex w-full flex-col border border-white/12 bg-[rgba(8,9,14,0.92)] backdrop-blur-xl outline-none",
              "shadow-[0_30px_90px_-30px_rgba(0,0,0,0.85)]",
              isDrawer
                ? clsx("h-full overflow-y-auto", DRAWER_SIZE[size])
                : clsx("max-h-[85vh] overflow-y-auto rounded-2xl", SIZE[size]),
              className
            )}
          >
            {/* accent top strip */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-bull to-transparent shadow-[0_0_18px_#00e676]"
            />
            {(title != null || showClose) && (
              <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
                {title != null &&
                  (typeof title === "string" ? (
                    <h2 id={labelId} className="t-label text-[15px] uppercase text-white">
                      {title}
                    </h2>
                  ) : (
                    <div id={labelId} className="min-w-0">
                      {title}
                    </div>
                  ))}
                {showClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close dialog"
                    className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-sky-300 transition-colors hover:border-bear/50 hover:text-bear focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <span aria-hidden className="text-base leading-none">
                      ✕
                    </span>
                  </button>
                )}
              </div>
            )}
            <div className="px-5 py-5 md:px-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export type DrawerProps = Omit<ModalProps, "side"> & {
  /** Which edge the drawer slides in from. Defaults to "right". */
  side?: "right" | "left";
};

/**
 * Slide-in panel — a thin wrapper over <Modal> locked to a side.
 * Same accessibility (focus trap, Esc, scrim, scroll-lock) as Modal.
 */
export function Drawer({ side = "right", ...rest }: DrawerProps) {
  return <Modal side={side} {...rest} />;
}
