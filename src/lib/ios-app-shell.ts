/**
 * Detects the Capacitor iOS app shell (blackout-ios) at runtime, client-side only.
 * `layout.tsx`'s inline head script adds the `ios-app` class to <html> when the
 * WKWebView's user-agent carries the "BlackOutiOSApp" token it appends (see
 * capacitor.config.ts's `appendUserAgent`). Reuse THAT class rather than re-parsing
 * the user agent here, so there's exactly one source of truth for "are we in the app."
 *
 * App Store guideline 3.1.1 forbids purchase-flow language/links inside the app —
 * use this to swap copy in code paths that can't be handled by the `.hide-in-ios-app`
 * / `.show-in-ios-app` CSS classes (e.g. a runtime string, not JSX markup). Safe to
 * call from an event handler or effect; do NOT call it during initial render of a
 * component that's also server-rendered — `document` doesn't exist during SSR, and
 * checking it synchronously in a render body causes a hydration mismatch. The CSS-class
 * dual-render pattern (render both variants, let CSS pick one) doesn't have that
 * problem and is preferred wherever the surface is plain JSX.
 */
export function isIosAppShell(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("ios-app");
}
