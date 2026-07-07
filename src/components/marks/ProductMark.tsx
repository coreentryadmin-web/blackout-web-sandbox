"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { clsx } from "clsx";
import { MARK_GEOMETRY } from "./geometry";

/** The seven product sigils. */
export type MarkProduct = "spx" | "helix" | "heatmap" | "largo" | "nighthawk" | "grid" | "atlas";

/** Canonical accent per product (design language — switching product = switching one CSS var). */
export const MARK_ACCENT: Record<MarkProduct, string> = {
  spx: "#00e676", // emerald — system / primary
  helix: "#bf5fff", // violet  — AI flow tape
  heatmap: "#ff6b2b", // orange  — heat
  largo: "#22d3ee", // cyan    — Largo (canonical cyan #22d3ee)
  nighthawk: "#ff2d55", // red     — the hunt
  grid: "#ffcc4d", // gold    — the market-intelligence command center
  atlas: "#2dd4bf", // teal    — live chart + level overlay
};

/**
 * Adapter from the existing accent vocab (Nav `FEATURE_LINKS`, FeaturesGrid) to a
 * MarkProduct, so callers can keep passing their existing accent strings.
 */
export const NAV_TO_MARK: Record<string, MarkProduct> = {
  green: "spx",
  purple: "helix",
  orange: "heatmap",
  blue: "largo",
  red: "nighthawk",
  gold: "grid",
  teal: "atlas",
};

const DEFAULT_TITLE: Record<MarkProduct, string> = {
  spx: "SPX Slayer",
  helix: "HELIX",
  heatmap: "BlackOut Thermal",
  largo: "Largo",
  nighthawk: "Night Hawk",
  grid: "BlackOut Grid",
  atlas: "Atlas",
};

export interface ProductMarkProps {
  product: MarkProduct;
  /** px, default 40. Drives width/height; viewBox is always 0 0 64 64. */
  size?: number;
  /** default true. false => render the static composed frame (adds .bo-static). */
  animated?: boolean;
  /** default false. Swaps bo-glow -> bo-glow-lg (stdDeviation 8) for large render. */
  hero?: boolean;
  /** accessible <title>; defaults to a per-product label. */
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** wrapper element, default "span". */
  as?: "span" | "div";
}

// The draw-on intro settles by ~1.5s (longest entrance: the focal/core boPop at a 1s
// delay + a follow-on breath). Freeze just after so the sigil animates ONCE.
const SETTLE_MS = 1700;
// Fallback freeze for sigils that NEVER scroll into view (e.g. closed nav-dropdown
// marks, far-below-the-fold marks). Without this they'd loop their ambient animations
// forever while off-screen/hidden — pure wasted GPU. Generous enough that on-screen
// sigils still play their draw-on (which resets to the shorter SETTLE_MS) first.
const SETTLE_FALLBACK_MS = 4000;

/**
 * IntersectionObserver hook — adds `.is-live` once when the mark scrolls into view to
 * fire the draw-on, then settles the sigil to its static composed frame so the ambient
 * loops (breath / shimmer / ring-spin / scan) stop running forever. This is a runtime-GPU
 * win: sigils appear all over the site (nav, features, headers), and the infinite loops
 * otherwise repaint/composite for as long as each sigil is on screen.
 *
 * Settling = remove `.is-live` (revert the draw-on start-state overrides, e.g. the helix /
 * largo stroke-dashoffset, back to their drawn base) + add `.bo-static` (the same clean,
 * fully-composed frame used by `animated={false}`, which kills all sigil animation). Never
 * branches motion in JS otherwise; reduced-motion is handled in CSS.
 */
function useDrawOn(animated: boolean) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!animated) return;
    const el = ref.current;
    if (!el) return;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      el.classList.remove("is-live"); // revert draw-on start-state overrides to the drawn base
      el.classList.add("bo-static"); // kill every sigil animation (clean composed frame)
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("is-live");
          io.disconnect();
          clearTimeout(settleTimer);
          settleTimer = setTimeout(settle, SETTLE_MS);
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    // Fallback: settle even if the sigil is never seen, so off-screen/hidden marks
    // don't loop forever. The IO path above clears + reschedules this to SETTLE_MS.
    settleTimer = setTimeout(() => {
      io.disconnect();
      settle();
    }, SETTLE_FALLBACK_MS);
    return () => {
      io.disconnect();
      clearTimeout(settleTimer);
    };
  }, [animated]);
  return ref;
}

/**
 * ProductMark — the reusable animated BlackOut sigil.
 *
 * Renders one product's geometry into a `viewBox="0 0 64 64"` svg; the shared
 * `<defs>` live once in `<SharedSigilDefs/>` at app root. `color: var(--accent)`
 * makes every `currentColor` gradient/filter inherit the product accent.
 */
export function ProductMark({
  product,
  size = 40,
  animated = true,
  hero = false,
  title,
  className,
  style,
  as: Wrapper = "span",
}: ProductMarkProps) {
  const ref = useDrawOn(animated);
  const accent = MARK_ACCENT[product];
  const label = title ?? DEFAULT_TITLE[product];

  return (
    <Wrapper className={className} style={{ display: "inline-flex", lineHeight: 0, ...style }}>
      <svg
        ref={ref}
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role="img"
        aria-label={label}
        className={clsx("bo-sigil", `bo-${product}`, hero && "bo-hero", !animated && "bo-static")}
        style={{ color: accent, ["--accent" as string]: accent }}
      >
        <title>{label}</title>
        {MARK_GEOMETRY[product]}
      </svg>
    </Wrapper>
  );
}
