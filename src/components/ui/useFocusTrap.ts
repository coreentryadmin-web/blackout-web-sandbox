"use client";

import { useCallback, useEffect, type RefObject } from "react";

/**
 * Focusable-element selector used to find the trap's edges. Mirrors the set
 * previously inlined in <Modal>.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), details, [tabindex]:not([tabindex="-1"])';

export type UseFocusTrapOptions = {
  /** When true, the trap is armed: focus is moved in, Tab is trapped, scroll is locked. */
  active: boolean;
  /**
   * Called when Esc is pressed while the trap is active. The handler stops
   * propagation before invoking this. Omit to ignore Esc.
   */
  onEscape?: () => void;
  /** Restore focus to the element that was focused before the trap opened. Defaults to true. */
  returnFocus?: boolean;
  /** Lock body scroll (overflow: hidden) while the trap is active. Defaults to true. */
  lockScroll?: boolean;
};

/**
 * Accessible focus trap for hand-rolled dialogs.
 *
 * Behaviour (extracted verbatim from the original <Modal> implementation so the
 * five dialogs already using Modal are not regressed):
 *  - on activate, records `document.activeElement` (the opener);
 *  - defers one rAF, then moves focus to the first focusable node inside `ref`
 *    (falling back to the container itself);
 *  - locks body scroll while active (opt-out via `lockScroll: false`);
 *  - a capturing keydown listener intercepts Esc (-> `onEscape`) and wraps
 *    Tab / Shift+Tab at the container's edges, querying the live focusable set
 *    on each keypress;
 *  - on deactivate/unmount, restores focus to the opener (opt-out via
 *    `returnFocus: false`).
 *
 * The container ref should point at the dialog panel and is expected to be
 * focusable (tabIndex={-1}) so focus has somewhere to land when empty.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  { active, onEscape, returnFocus = true, lockScroll = true }: UseFocusTrapOptions
): void {
  const getFocusable = useCallback((): HTMLElement[] => {
    const root = ref.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
  }, [ref]);

  // Record the opener + move focus into the container when it activates.
  useEffect(() => {
    if (!active) return;
    const opener = (document.activeElement as HTMLElement) ?? null;

    // Defer to let the container mount/animate in before focusing.
    const raf = requestAnimationFrame(() => {
      const focusable = getFocusable();
      (focusable[0] ?? ref.current)?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      // Return focus to the opener on close/unmount.
      if (returnFocus) opener?.focus?.();
    };
  }, [active, getFocusable, ref, returnFocus]);

  // Body scroll-lock while active.
  useEffect(() => {
    if (!active || !lockScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active, lockScroll]);

  // Esc-to-close + Tab focus trap.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) {
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing focusable inside — keep focus on the container.
        e.preventDefault();
        ref.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeEl === first || !ref.current?.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !ref.current?.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, onEscape, getFocusable, ref]);
}
