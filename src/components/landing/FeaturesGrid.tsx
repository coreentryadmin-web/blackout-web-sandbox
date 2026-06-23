"use client";

import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { CSSProperties } from "react";
import { ProductMark, type MarkProduct } from "@/components/marks/ProductMark";

const FEATURES: {
  num: string;
  title: string;
  sub: string;
  desc: string;
  tier: string;
  accent: string;
  rotate: string;
  topAccent: string;
  badgeGlow: string;
  /** Per-product sigil; null for cards with no single product (e.g. Pre-Market Brief). */
  mark: MarkProduct | null;
}[] = [
  {
    num: "01",
    title: "SPX LIVE",
    sub: "Dashboard",
    desc: "Live GEX, VWAP, regime shifts, and dealer gamma exposure — every 0DTE edge fused into one war room.",
    tier: "Premium",
    accent: "border-bull text-bull",
    rotate: "-rotate-1",
    topAccent: "green",
    badgeGlow: "bull",
    mark: "spx",
  },
  {
    num: "02",
    title: "HELIX",
    sub: "Flow Feed",
    desc: "Institutional block prints and dark pool sweeps in real time. Smart money leaves footprints — HELIX catches every one.",
    tier: "Premium",
    accent: "border-purple text-purple-light",
    rotate: "rotate-1",
    topAccent: "purple",
    badgeGlow: "purple",
    mark: "helix",
  },
  {
    num: "03",
    title: "SECTOR",
    sub: "Heatmaps",
    desc: "Live rotation heatmaps that show where the real bid is hiding before the crowd finds out.",
    tier: "Premium",
    accent: "border-ember text-ember",
    rotate: "-rotate-2",
    topAccent: "ember",
    badgeGlow: "ember",
    mark: "heatmap",
  },
  {
    num: "04",
    title: "LARGO",
    sub: "AI Desk",
    desc: "Your personal trading desk intelligence. Ask anything — Largo reads the live tape, pulls flow, and thinks in structure.",
    tier: "Premium",
    accent: "border-purple text-purple-light",
    rotate: "rotate-2",
    topAccent: "blue",
    badgeGlow: "purple",
    mark: "largo",
  },
  {
    num: "05",
    title: "NIGHT",
    sub: "Hawk",
    desc: "Every night, Night Hawk hunts the close for 2–10 DTE setups — full dossier on every play, zero noise.",
    tier: "Premium",
    accent: "border-cyan text-cyan",
    rotate: "-rotate-1",
    topAccent: "cyan",
    badgeGlow: "cyan",
    mark: "nighthawk",
  },
  {
    num: "06",
    title: "PRE-MARKET",
    sub: "Brief",
    desc: "Before the bell rings, your AI desk reads overnight developments and serves a precise SPX battle plan. Know your levels before price moves.",
    tier: "Premium",
    accent: "border-bull text-bull",
    rotate: "rotate-1",
    topAccent: "yellow",
    badgeGlow: "gold",
    mark: null,
  },
];

const ACCENT_COLORS: Record<string, string> = {
  green: "#00e676",
  purple: "#bf5fff",
  orange: "#ff6b2b",
  ember: "#ff6b2b",
  blue: "#3b82f6",
  red: "#ff2d55",
  cyan: "#00d4ff",
  yellow: "#ffd23f",
};

const headingLines = ["EVERYTHING", "YOU NEED"];

const cardVariants = {
  hidden: { opacity: 0, y: 60 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: i * 0.1 },
  }),
};

const lineVariants = {
  hidden: { opacity: 0, x: -48 },
  show: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: i * 0.2 },
  }),
};

export function FeaturesGrid() {
  return (
    <section id="features" className="landing-section landing-section-cut relative py-32 px-4 md:px-8 overflow-hidden">
      <div className="relative z-10 mb-16 md:mb-24">
        <motion.p
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-2"
        >
          ◆ Platform
        </motion.p>
        <h2 className="font-anton text-6xl md:text-8xl lg:text-9xl leading-none tracking-tight text-white mix-blend-difference">
          {headingLines.map((line, i) => (
            <motion.span
              key={line}
              custom={i}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-80px" }}
              variants={lineVariants}
              className={clsx("block", i === 1 && "text-stroke-green")}
            >
              {line}
            </motion.span>
          ))}
        </h2>
      </div>

      <div className="relative max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-5">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.num}
              custom={i}
              initial="hidden"
              whileInView="show"
              whileHover={{ y: -6 }}
              viewport={{ once: true, margin: "-40px" }}
              variants={cardVariants}
              className={clsx(
                "relative group",
                i % 3 === 1 && "md:-mt-8 lg:-mt-12",
                i % 3 === 2 && "md:mt-4"
              )}
            >
              <div
                className={clsx("bento-card-wrap", f.rotate, "transition-transform duration-500 group-hover:rotate-0")}
                style={
                  {
                    "--card-accent-color": ACCENT_COLORS[f.topAccent] ?? ACCENT_COLORS.green,
                  } as CSSProperties
                }
              >
                <div
                  className={clsx(
                    "bento-card-inner",
                    `bento-accent-${f.topAccent}`,
                    f.accent.split(" ")[1]
                  )}
                >
                  <span className="bento-card-watermark" aria-hidden>
                    {f.num}
                  </span>
                  {f.mark && (
                    <span className="mb-3 block" aria-hidden>
                      <ProductMark product={f.mark} size={42} />
                    </span>
                  )}
                  <span className={clsx("font-mono text-sm font-bold opacity-40", f.accent.split(" ")[1])}>
                    {f.num}
                  </span>
                  <h3 className="font-syne font-extrabold text-3xl md:text-4xl leading-none tracking-tight text-white mt-2">
                    {f.title}
                    <br />
                    <span className={f.accent.split(" ")[1]}>{f.sub}</span>
                  </h3>
                  <p className="text-sky-300 text-xs md:text-sm mt-4 leading-relaxed">{f.desc}</p>
                  <span className={clsx("tier-badge-pro mt-5 inline-block", `tier-badge-glow-${f.badgeGlow}`)}>
                    {f.tier}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
