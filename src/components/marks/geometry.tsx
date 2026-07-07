import type { ReactNode } from "react";
import type { MarkProduct } from "./ProductMark";

/**
 * MARK_GEOMETRY — the 5 cleaned inner-SVG bodies for the BlackOut Sigil System.
 *
 * Each block is the geometry ONLY (defs live once in <SharedSigilDefs/>). All five
 * are authored on a `viewBox="0 0 64 64"` canvas and reference the shared `bo-*` /
 * `nh-*` ids via `url(#…)`. Animation/static collapse is handled entirely in CSS
 * (globals.css, `.bo-sigil` rules) — this file is pure markup.
 *
 * `pathLength` is set on every animated stroke (bo-curve=62, helix strands & largo
 * wave =120) so the stroke-dasharray draw-on math is canvas-independent.
 */
export const MARK_GEOMETRY: Record<MarkProduct, ReactNode> = {
  // === SPX SLAYER (emerald) — sniper reticle locking onto a gamma curve ===
  spx: (
    <>
      <line x1="14" y1="40" x2="50" y2="40" stroke="url(#bo-emerald-thread)" strokeWidth="0.7" />
      <g className="bo-tick" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <line x1="32" y1="3.5" x2="32" y2="8.5" />
        <line x1="32" y1="55.5" x2="32" y2="60.5" />
        <line x1="3.5" y1="32" x2="8.5" y2="32" />
        <line x1="55.5" y1="32" x2="60.5" y2="32" />
      </g>
      <circle className="bo-ring bo-r3" cx="32" cy="32" r="25.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.6 3.9" opacity="0.7" />
      <circle className="bo-ring bo-r2" cx="32" cy="32" r="17.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.6 3.9" opacity="0.85" />
      <circle className="bo-ring bo-r1" cx="32" cy="32" r="9.3" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.6" />
      <path className="bo-curve" d="M11 44 C20 43,26 40,32 20 C38 40,44 43,53 44" fill="none" stroke="url(#bo-accent-linear)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" pathLength={62} />
      <g clipPath="url(#bo-scan-clip)">
        <rect className="bo-scan" x="28" y="6" width="8" height="52" fill="url(#bo-scan-sweep)" />
      </g>
      <g className="bo-node">
        <g className="bo-glowgrp" filter="url(#bo-glow)">
          <circle cx="32" cy="20" r="7" fill="url(#bo-accent-radial)" />
        </g>
        <circle className="bo-node-halo" cx="32" cy="20" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.5" />
        <circle className="bo-node-core" cx="32" cy="20" r="2.1" fill="currentColor" />
      </g>
    </>
  ),

  // === HELIX (violet) — call/put double-helix flow tape ===
  helix: (
    <>
      <line className="bo-thread" x1="10" y1="40" x2="54" y2="40" stroke="url(#bo-emerald-thread)" strokeWidth="0.7" />
      <circle className="bo-ring" cx="32" cy="32" r="17" fill="none" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.28" strokeDasharray="2 3" />
      <g className="bo-rungs" stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.25" strokeLinecap="round">
        <line x1="42" y1="16" x2="22" y2="16" />
        <line x1="42" y1="32" x2="22" y2="32" />
        <line x1="42" y1="48" x2="22" y2="48" />
      </g>
      <g className="bo-strands" fill="none" stroke="url(#bo-accent-linear)" strokeWidth="2.7" strokeLinecap="round">
        <path className="bo-strandA" d="M32 8 C 44 14, 44 26, 32 32 C 20 38, 20 50, 32 56" pathLength={120} />
        <path className="bo-strandB" d="M32 8 C 20 14, 20 26, 32 32 C 44 38, 44 50, 32 56" strokeOpacity="0.55" pathLength={120} />
      </g>
      <g filter="url(#bo-glow)" className="bo-bloom">
        <circle cx="32" cy="32" r="11" fill="url(#bo-accent-radial)" className="bo-glow-fill" />
      </g>
      <g className="bo-flow bo-flow-call">
        <g className="bo-node n1">
          <circle className="bo-halo" cx="42" cy="16" r="3.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.5" />
          <circle cx="42" cy="16" r="2.1" fill="currentColor" />
        </g>
        <g className="bo-node n2">
          <circle className="bo-halo" cx="22" cy="44" r="3.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.5" />
          <circle cx="22" cy="44" r="2.1" fill="currentColor" />
        </g>
      </g>
      <g className="bo-flow bo-flow-put" opacity="0.6">
        <g className="bo-node n3">
          <circle className="bo-halo" cx="22" cy="16" r="3.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.5" />
          <circle cx="22" cy="16" r="2.1" fill="currentColor" />
        </g>
        <g className="bo-node n4">
          <circle className="bo-halo" cx="42" cy="44" r="3.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.5" />
          <circle cx="42" cy="44" r="2.1" fill="currentColor" />
        </g>
      </g>
      <g className="bo-node bo-focal" filter="url(#bo-glow)">
        <circle className="bo-halo" cx="32" cy="32" r="3.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.6" />
        <circle cx="32" cy="32" r="2.4" fill="currentColor" />
      </g>
    </>
  ),

  // === HEATMAPS (orange) — perspective floor of rolling heat cells (5x4) ===
  heatmap: (
    <>
      <circle className="bo-ring" cx="32" cy="32" r="25.3" fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity="0.55" strokeDasharray="2 3" />
      <line className="bo-thread" x1="10" y1="40" x2="54" y2="40" stroke="url(#bo-emerald-thread)" strokeWidth="0.5" />
      <g className="bo-rails" fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity="0.18" strokeLinecap="round">
        <path d="M16 46 L22 24" />
        <path d="M24 46 L26.5 24" />
        <path d="M32 46 L31 24" />
        <path d="M40 46 L37.5 24" />
        <path d="M48 46 L42 24" />
        <path d="M14.5 46 L49.5 46" />
        <path d="M18 38.7 L46 38.7" />
        <path d="M20.4 31.5 L43.6 31.5" />
        <path d="M22 24 L42 24" />
      </g>
      <g className="bo-cells">
        {/* row 4 (nearest/front) */}
        <rect className="c d0" x="15.3" y="41" width="6.0" height="3.6" rx="1.2" fill="currentColor" opacity="0.30" />
        <rect className="c d1" x="22.0" y="41" width="6.0" height="3.6" rx="1.2" fill="currentColor" opacity="0.30" />
        <rect className="c d2" x="28.7" y="41" width="6.4" height="3.6" rx="1.2" fill="currentColor" opacity="0.30" />
        <rect className="c d3" x="35.8" y="41" width="6.0" height="3.6" rx="1.2" fill="currentColor" opacity="0.30" />
        <rect className="c d4" x="42.5" y="41" width="6.0" height="3.6" rx="1.2" fill="currentColor" opacity="0.30" />
        {/* row 3 */}
        <rect className="c d1" x="18.4" y="34.2" width="5.2" height="3.3" rx="1.1" fill="currentColor" opacity="0.30" />
        <rect className="c d2" x="24.2" y="34.2" width="5.2" height="3.3" rx="1.1" fill="currentColor" opacity="0.30" />
        <rect className="c d3" x="30.0" y="34.2" width="5.6" height="3.3" rx="1.1" fill="currentColor" opacity="0.30" />
        <rect className="c d4" x="36.2" y="34.2" width="5.2" height="3.3" rx="1.1" fill="currentColor" opacity="0.30" />
        <rect className="c d0" x="42.0" y="34.2" width="5.2" height="3.3" rx="1.1" fill="currentColor" opacity="0.30" />
        {/* row 2 */}
        <rect className="c d2" x="20.8" y="27.4" width="4.4" height="2.9" rx="1.0" fill="currentColor" opacity="0.30" />
        <rect className="c d3" x="25.8" y="27.4" width="4.4" height="2.9" rx="1.0" fill="currentColor" opacity="0.30" />
        <rect className="c d4" x="30.8" y="27.4" width="4.6" height="2.9" rx="1.0" fill="currentColor" opacity="0.30" />
        <rect className="c d0" x="35.9" y="27.4" width="4.4" height="2.9" rx="1.0" fill="currentColor" opacity="0.30" />
        <rect className="c d1" x="40.9" y="27.4" width="4.4" height="2.9" rx="1.0" fill="currentColor" opacity="0.30" />
        {/* row 1 (farthest/back) */}
        <rect className="c d3" x="22.8" y="21.0" width="3.7" height="2.5" rx="0.9" fill="currentColor" opacity="0.30" />
        <rect className="c d4" x="27.2" y="21.0" width="3.7" height="2.5" rx="0.9" fill="currentColor" opacity="0.30" />
        <rect className="c d0" x="31.6" y="21.0" width="3.9" height="2.5" rx="0.9" fill="currentColor" opacity="0.30" />
        <rect className="c d1" x="36.1" y="21.0" width="3.7" height="2.5" rx="0.9" fill="currentColor" opacity="0.30" />
        <rect className="c d2" x="40.5" y="21.0" width="3.7" height="2.5" rx="0.9" fill="currentColor" opacity="0.30" />
      </g>
      <g className="bo-focal" filter="url(#bo-glow)">
        <circle cx="31.9" cy="42.8" r="8" fill="url(#bo-accent-radial)" />
        <circle className="bo-ping" cx="31.9" cy="42.8" r="3.7" fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
        <circle className="bo-node" cx="31.9" cy="42.8" r="2.1" fill="currentColor" />
      </g>
    </>
  ),

  // === LARGO AI (cyan #22d3ee) — thinking rings + waveform through the core ===
  largo: (
    <>
      <line className="bo-thread" x1="9" y1="40" x2="55" y2="40" stroke="url(#bo-emerald-thread)" strokeWidth="0.5" />
      <g className="bo-rings" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
        <circle className="bo-ring bo-ring-outer" cx="32" cy="32" r="25.3" strokeDasharray="4 6" opacity="0.45" />
        <circle className="bo-ring bo-ring-mid" cx="32" cy="32" r="17.3" strokeDasharray="2 3" opacity="0.7" />
        <circle className="bo-ring bo-ring-inner" cx="32" cy="32" r="9.3" strokeDasharray="4 6" opacity="0.55" />
      </g>
      <g className="bo-wave">
        <path className="bo-wave-path" d="M9 32 q3.3 -7 6.6 0 t6.6 0 t6.6 0 t6.6 0 t6.6 0 t6.6 0" fill="none" stroke="url(#bo-accent-linear)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" pathLength={120} />
      </g>
      <g className="bo-ticks" fill="currentColor">
        <g className="bo-tick bo-tick-w">
          <circle cx="14.7" cy="32" r="2.8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
          <circle cx="14.7" cy="32" r="1.6" />
        </g>
        <g className="bo-tick bo-tick-e">
          <circle cx="49.3" cy="32" r="2.8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
          <circle cx="49.3" cy="32" r="1.6" />
        </g>
      </g>
      <g className="bo-core" filter="url(#bo-glow)">
        <circle className="bo-core-bloom" cx="32" cy="32" r="8" fill="url(#bo-accent-radial)" />
        <circle className="bo-core-node" cx="32" cy="32" r="2.1" fill="currentColor" />
      </g>
    </>
  ),

  // === BLACKOUT GRID (gold) — a market-intelligence masonry: four live tiles ===
  // A 2x2 grid of rounded panels (the "command center") with a sweeping scan over
  // them and a glowing focal tile. Reuses the shared bo-* defs (glow / accent
  // radial+linear / scan sweep) + the bo-scan-clip so the draw-on animation
  // matches the rest of the sigil system. No own defs (they live in SharedSigilDefs).
  grid: (
    <>
      <line x1="12" y1="40" x2="52" y2="40" stroke="url(#bo-emerald-thread)" strokeWidth="0.7" />
      <circle className="bo-ring bo-r3" cx="32" cy="32" r="25.3" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2.6 3.9" opacity="0.4" />
      {/* the masonry frame — four tiles outlined, drawn-on like the other strokes */}
      <g className="bo-cells" fill="none" stroke="url(#bo-accent-linear)" strokeWidth="2.4" strokeLinejoin="round">
        <rect className="c d0" x="13" y="13" width="16" height="16" rx="3" opacity="0.85" />
        <rect className="c d1" x="35" y="13" width="16" height="16" rx="3" opacity="0.6" />
        <rect className="c d2" x="13" y="35" width="16" height="16" rx="3" opacity="0.6" />
        <rect className="c d3" x="35" y="35" width="16" height="16" rx="3" opacity="0.85" />
      </g>
      {/* sweeping scan across the board */}
      <g clipPath="url(#bo-scan-clip)">
        <rect className="bo-scan" x="8" y="6" width="10" height="52" fill="url(#bo-scan-sweep)" />
      </g>
      {/* glowing focal tile — the "live" cell */}
      <g className="bo-node">
        <g className="bo-glowgrp" filter="url(#bo-glow)">
          <rect x="36" y="36" width="14" height="14" rx="3" fill="url(#bo-accent-radial)" />
        </g>
        <circle className="bo-node-core" cx="43" cy="43" r="2.1" fill="currentColor" />
      </g>
    </>
  ),

  // === NIGHT HAWK (red) — dusk radar sweep painting threat blips ===
  // Re-centered per cleanup note: geometry stays authored at 24-center inside the
  // translate(8 8) wrapper; rotation pivots on the visual center via CSS
  // (transform-origin 32 32), and the bogus inline transform-origins are removed.
  nighthawk: (
    <g className="nh-root" transform="translate(8 8)">
      <circle cx="24" cy="24" r="22" fill="url(#bo-void)" />
      <line className="nh-thread" x1="6" y1="30" x2="42" y2="30" stroke="url(#bo-emerald-thread)" strokeWidth="0.5" />
      <g className="nh-rings" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55">
        <circle className="nh-ring nh-ring-outer" cx="24" cy="24" r="19" strokeDasharray="2 3" />
        <circle className="nh-ring nh-ring-mid" cx="24" cy="24" r="13" strokeDasharray="2 3" />
        <circle className="nh-ring nh-ring-inner" cx="24" cy="24" r="7" strokeDasharray="2 3" opacity="0.7" />
      </g>
      <g className="nh-ticks" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.7">
        <line x1="24" y1="2" x2="24" y2="6" />
        <line x1="46" y1="24" x2="42" y2="24" />
        <line x1="24" y1="46" x2="24" y2="42" />
        <line x1="2" y1="24" x2="6" y2="24" />
      </g>
      <g className="nh-sweep">
        <g clipPath="url(#nh-wedge)">
          <rect className="nh-wedge-fill" x="24" y="4" width="20" height="20" fill="url(#bo-scan-sweep)" />
        </g>
        <line className="nh-sweepline" x1="24" y1="24" x2="44" y2="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className="nh-blip nh-blip-1">
        <circle cx="33" cy="14" r="2.8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <circle cx="33" cy="14" r="1.6" fill="currentColor" />
      </g>
      <g className="nh-blip nh-blip-2">
        <circle cx="14.5" cy="31" r="2.8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <circle cx="14.5" cy="31" r="1.6" fill="currentColor" />
      </g>
      <g className="nh-focal" filter="url(#bo-glow)">
        <circle cx="31" cy="33" r="9" fill="url(#bo-accent-radial)" className="nh-bloom" />
        <circle cx="31" cy="33" r="2.8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <circle cx="31" cy="33" r="1.7" fill="currentColor" />
      </g>
    </g>
  ),

  // === ATLAS (teal) — an ascending candlestick tape with a live focal print ===
  // Static for now (no .bo-atlas keyframes exist yet in globals.css, unlike the other six —
  // the bo-node/bo-glowgrp classes below are inert without them, which renders a clean still
  // frame rather than a broken half-animated one). Add matching keyframes when Atlas gets its
  // own animation pass.
  atlas: (
    <>
      <line x1="10" y1="46" x2="54" y2="46" stroke="url(#bo-emerald-thread)" strokeWidth="0.7" />
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.85">
        <line x1="18" y1="30" x2="18" y2="42" />
        <line x1="32" y1="20" x2="32" y2="46" />
        <line x1="46" y1="9" x2="46" y2="34" />
      </g>
      <g fill="url(#bo-accent-linear)">
        <rect x="14" y="33" width="8" height="10" rx="1.5" opacity="0.7" />
        <rect x="28" y="24" width="8" height="16" rx="1.5" opacity="0.85" />
        <rect x="42" y="14" width="8" height="14" rx="1.5" />
      </g>
      <g className="bo-node" filter="url(#bo-glow)">
        <circle cx="46" cy="11" r="6" fill="url(#bo-accent-radial)" className="bo-glowgrp" />
        <circle cx="46" cy="11" r="2" fill="currentColor" className="bo-node-core" />
      </g>
    </>
  ),
};
