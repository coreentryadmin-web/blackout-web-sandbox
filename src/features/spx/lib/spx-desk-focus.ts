/**
 * FOCUS MODE (SPX desk, 2026-07-13) — pure hotkey/persistence helpers for the collapsed
 * desk layout (Largo + ladder shrink to slim rails, chart fills). Keyboard: `F` toggles,
 * `Esc` exits; both ignored while typing. The component owns the DOM listener; these
 * helpers own the decisions so they are unit-testable via `tsx --test`.
 */

export const SPX_DESK_FOCUS_STORAGE_KEY = "spx-desk-focus-mode";

type HotkeyTargetLike = {
  tagName?: string | null;
  isContentEditable?: boolean;
} | null;

type HotkeyEventLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
};

/** True when the key press happened inside a text-entry surface — hotkeys must not fire. */
export function isTypingTarget(target: HotkeyTargetLike): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export type FocusKeyAction = "toggle" | "exit" | null;

/**
 * Decide what a keydown does to focus mode:
 *  - `f`/`F` (no modifiers, not typing, not a held-key repeat) → toggle;
 *  - `Escape` while focus mode is active → exit;
 *  - anything else → null.
 * Modifier chords (⌘F browser find, Ctrl+F, etc.) are always left alone.
 */
export function focusHotkeyAction(
  ev: HotkeyEventLike,
  target: HotkeyTargetLike,
  focusActive: boolean
): FocusKeyAction {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return null;
  if (isTypingTarget(target)) return null;
  if (ev.repeat) return null;
  if (ev.key === "f" || ev.key === "F") return "toggle";
  if (ev.key === "Escape" && focusActive) return "exit";
  return null;
}

/** Next focus state for an action (pure, so the reducer path is testable). */
export function nextFocusState(current: boolean, action: FocusKeyAction): boolean {
  if (action === "toggle") return !current;
  if (action === "exit") return false;
  return current;
}
