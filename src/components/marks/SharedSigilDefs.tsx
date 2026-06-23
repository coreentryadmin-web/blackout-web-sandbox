/**
 * SharedSigilDefs — the ONE shared <defs> block for the BlackOut Sigil System.
 *
 * Rendered once at app root (layout.tsx) as an absolutely-positioned, zero-size,
 * aria-hidden <svg>. Every <ProductMark> references these namespaced `bo-*` / `nh-*`
 * ids by `url(#…)` — the defs are NEVER duplicated per instance (5 copies of
 * `id="bo-glow"` would collide).
 *
 * Gradients tint by accent via `currentColor`; each sigil root sets
 * `color: var(--accent)` so the gradients/filters inherit. The emerald thread is
 * locked to #00e676 (the literal shared cross-desk hairline).
 */
export function SharedSigilDefs() {
  return (
    <svg
      aria-hidden
      focusable="false"
      width={0}
      height={0}
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        {/* focal bloom fill */}
        <radialGradient id="bo-accent-radial" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="45%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>

        {/* flowing-stroke fade (tape/curve ends fade for seamless loops) */}
        <linearGradient id="bo-accent-linear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="25%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="75%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>

        {/* instrument scan bar / radar wedge gradient */}
        <linearGradient id="bo-scan-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>

        {/* seated-disc backplate (matches the global substrate) */}
        <radialGradient id="bo-void" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#050608" />
          <stop offset="100%" stopColor="#040407" />
        </radialGradient>

        {/* the one-desk emerald thread — locked to #00e676, NOT currentColor */}
        <linearGradient id="bo-emerald-thread" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#00e676" stopOpacity="0" />
          <stop offset="50%" stopColor="#00e676" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#00e676" stopOpacity="0" />
        </linearGradient>

        {/* the single capped bloom (small). Only its group opacity ever animates. */}
        <filter id="bo-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* hero bloom (large) */}
        <filter id="bo-glow-lg" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* SPX instrument scan clip (the disc) */}
        <clipPath id="bo-scan-clip">
          <circle cx="32" cy="32" r="25.5" />
        </clipPath>

        {/* Night Hawk radar sweep wedge (authored in the 24-center / translate(8 8) space) */}
        <clipPath id="nh-wedge">
          <path d="M24 24 L44 24 A20 20 0 0 0 41.3 13.9 Z" />
        </clipPath>
      </defs>
    </svg>
  );
}
