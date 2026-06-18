"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { clsx } from "clsx";

const TOOLS = [
  {
    href: "/dashboard",
    name: "SPX",
    accent: "SLAYER",
    tag: "0DTE · GEX · VWAP",
    color: "green",
    rotate: "-rotate-1",
  },
  {
    href: "/flows",
    name: "FLOW",
    accent: "FEED",
    tag: "WHALE · DARK POOL",
    color: "purple",
    rotate: "rotate-1",
  },
  {
    href: "/heatmap",
    name: "SECTOR",
    accent: "HEAT",
    tag: "LIVE ROTATION",
    color: "orange",
    rotate: "-rotate-2",
  },
  {
    href: "/terminal",
    name: "LARGO",
    accent: "AI",
    tag: "DESK TERMINAL",
    color: "blue",
    rotate: "rotate-2",
  },
  {
    href: "/nighthawk",
    name: "NIGHT",
    accent: "HAWK",
    tag: "2–10 DTE SWINGS",
    color: "red",
    rotate: "-rotate-1",
  },
] as const;

const accentText: Record<(typeof TOOLS)[number]["color"], string> = {
  green: "text-bull",
  purple: "text-purple-light",
  orange: "text-orange-400",
  blue: "text-sky-400",
  red: "text-bear",
};

const cardVariants = {
  hidden: { opacity: 0, y: 32, scale: 0.92 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 140,
      damping: 18,
      delay: 0.2 + i * 0.08,
    },
  }),
};

export function HeroToolsRail() {
  return (
    <div className="hero-tools-rail relative z-20">
      <div className="hero-tools-rail-scan" aria-hidden />
      <div className="hero-tools-rail-inner">
        <motion.p
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="hero-tools-rail-label"
        >
          ◆ LIVE TOOLKIT ◆
        </motion.p>

        <div className="hero-tools-rail-track">
          {TOOLS.map((tool, i) => (
            <motion.div
              key={tool.href}
              custom={i}
              initial="hidden"
              animate="show"
              variants={cardVariants}
              className={clsx("hero-tool-card-wrap group", tool.rotate, "hover:rotate-0 transition-transform duration-500")}
            >
              <div className="hero-tool-card-glow" aria-hidden />
              <Link
                href={tool.href}
                className={clsx("hero-tool-card", `hero-tool-accent-${tool.color}`)}
              >
                <span className="hero-tool-card-num" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={clsx("hero-tool-name", accentText[tool.color])}>{tool.name}</span>
                <span className="hero-tool-accent">{tool.accent}</span>
                <span className="hero-tool-tag">{tool.tag}</span>
                <span className="hero-tool-arrow" aria-hidden>
                  →
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
