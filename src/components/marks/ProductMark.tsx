"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { clsx } from "clsx";
import { MARK_GEOMETRY } from "./geometry";

/** The six product sigils. */
export type MarkProduct = "spx" | "helix" | "heatmap" | "largo" | "nighthawk" | "grid";

/** Canonical accent per product (design language — switching product = switching one CSS var). */
export const MARK_ACCENT: Record<MarkProduct, string> = {
  spx: "#00e676", // emerald — system / primary
  helix: "#bf5fff", // violet  — AI flow tape
  heatmap: "#ff6b2b", // orange  — heat
  largo: "#22d3ee", // cyan    — Largo (canonical cyan #22d3ee)
  nighthawk: "#ff2d55", // red     — the hunt
  grid: "#ffcc4d", // gold    — the market-intelligence command center
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
};

const DEFAULT_TITLE: Record<MarkProduct, string> = {
  spx: "SPX Slayer",
  helix: "HELIX",
  heatmap: "BlackOut Thermal",
  largo: "Largo",
  nighthawk: "Night Hawk",
  grid: "BlackOut Grid",
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

/**
 * IntersectionObserver hook — adds `.is-live` once when the mark scrolls into view,
 * firing the draw-on. Never branches motion in JS; reduced-motion is handled in CSS.
 */
function useDrawOn(animated: boolean) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!animated) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("is-live");
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
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
