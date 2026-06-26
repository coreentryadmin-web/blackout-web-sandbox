"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { CSSProperties } from "react";
import { ProductMark, MARK_ACCENT, type MarkProduct } from "@/components/marks/ProductMark";
import { LandingBackdrop } from "@/components/landing/LandingBackdrop";

type Weapon = {
  /** null => Pre-Market (feature, no sigil). */
  mark: MarkProduct | null;
  accentKey: string;
  accent: string;
  name: string;
  spec: string;
  desc: string;
  meta: string;
  href: string;
};

const ARSENAL: Weapon[] = [
  {
    mark: "spx",
    accentKey: "green",
    accent: MARK_ACCENT.spx,
    name: "SPX Slayer",
    spec: "0DTE · GEX · VWAP",
    meta: "Instrument · 01",
    href: "/dashboard",
    desc: "The 0DTE command desk — live SPX with VWAP, gamma and internals, plus a graded play card that tells you the setup and the one thing that kills it.",
  },
  {
    mark: "helix",
    accentKey: "purple",
    accent: MARK_ACCENT.helix,
    name: "HELIX",
    spec: "Whale · Dark Pool",
    meta: "Instrument · 02",
    href: "/flows",
    desc: "Real-time options flow that surfaces institutional footprints — repeated-hit strike stacks, sweeps versus blocks, where size is actually positioning.",
  },
  {
    mark: "heatmap",
    accentKey: "orange",
    accent: MARK_ACCENT.heatmap,
    name: "Heatmaps",
    spec: "Dealer GEX · VEX",
    meta: "Instrument · 03",
    href: "/heatmap",
    desc: "Dealer positioning, mapped — GEX, VEX, DEX and charm by strike. See the gamma walls, the flip level, and where dealer flow pins or repels price before you take a single trade.",
  },
  {
    mark: "largo",
    accentKey: "cyan",
    accent: MARK_ACCENT.largo,
    name: "Largo AI",
    spec: "Desk Terminal",
    meta: "Instrument · 04",
    href: "/terminal",
    desc: "Your AI desk analyst with full access to every tool's live data. Ask anything in plain English — it answers grounded in live data and shows its work.",
  },
  {
    mark: "nighthawk",
    accentKey: "red",
    accent: MARK_ACCENT.nighthawk,
    name: "Night Hawk",
    spec: "Playbook · Evening Edition",
    meta: "Instrument · 05",
    href: "/nighthawk",
    desc: "Your AI evening playbook — after the close it builds ranked swing and leap setups with a per-ticker dossier, so you walk in tomorrow with a plan.",
  },
  {
    mark: "grid",
    accentKey: "gold",
    accent: MARK_ACCENT.grid,
    name: "BlackOut Grid",
    spec: "Market-Intelligence Command Center",
    meta: "Instrument · 06",
    href: "/grid",
    desc: "The whole tape on one board — a live masonry of market-wide news, notable flow, analyst actions and the market pulse, so you read the entire session at a glance.",
  },
  {
    mark: null,
    accentKey: "yellow",
    accent: "#ffd23f",
    name: "Pre-Market Brief",
    spec: "Before the bell",
    meta: "Feature",
    href: "/dashboard",
    desc: "Before the open, your AI desk reads the overnight session and maps a precise SPX plan — your levels, set before price moves.",
  },
];

const card = {
  hidden: { opacity: 0, y: 48 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const, delay: i * 0.08 },
  }),
};

export function FeaturesGrid() {
  return (
    <section id="features" className="relative py-28 md:py-32 px-4 md:px-8 overflow-hidden">
      <LandingBackdrop />

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* header — mirrors Pricing/Faq */}
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-14 md:mb-20 text-center"
        >
          <p className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-3 flex items-center justify-center gap-2">
            <span
              aria-hidden
              className="inline-block h-[6px] w-[6px] rounded-full bg-bull animate-pulse motion-reduce:animate-none"
              style={{ boxShadow: "0 0 10px #00e676" }}
            />
            The Desk · 6 Instruments
          </p>
          <h2 className="font-anton text-5xl md:text-[4.5rem] leading-[0.92] tracking-tight text-white">
            THE{" "}
            <span
              style={{
                background: "linear-gradient(90deg,#00e676,#34d399 55%,#7dd3fc)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              ARSENAL.
            </span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-secondary max-w-2xl mx-auto">
            One membership. The whole desk — every instrument the floor runs on, in one screen.
          </p>
        </motion.div>

        {/* grid — flat, no rotation, no mt offsets */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6 items-stretch">
          {ARSENAL.map((w, i) => (
            <motion.div
              key={w.name}
              custom={i}
              initial="hidden"
              whileInView="show"
              whileHover={{ y: -6 }}
              viewport={{ once: true, margin: "-40px" }}
              variants={card}
              className="group"
            >
              <Link
                href={w.href}
                className={clsx("bento-card-wrap block h-full", `bento-accent-${w.accentKey}`)}
                style={{ "--card-accent-color": w.accent } as CSSProperties}
              >
                <div className="bento-card-inner flex flex-col h-full">
                  {/* top row: sigil + meta */}
                  <div className="flex items-start justify-between">
                    <span className="relative inline-flex" aria-hidden>
                      <span
                        className="absolute inset-0 -z-10 rounded-full blur-xl transition-opacity opacity-50 group-hover:opacity-90"
                        style={{ background: `radial-gradient(closest-side, ${w.accent}, transparent)` }}
                      />
                      {w.mark ? (
                        <ProductMark product={w.mark} size={48} />
                      ) : (
                        <span
                          className="grid h-12 w-12 place-items-center font-anton text-2xl"
                          style={{ color: w.accent }}
                        >
                          PM
                        </span>
                      )}
                    </span>
                    <span
                      className="font-mono text-[10px] tracking-[0.25em] uppercase"
                      style={{ color: w.accent }}
                    >
                      {w.meta}
                    </span>
                  </div>

                  {/* name + spec */}
                  <h3 className="font-syne font-extrabold text-3xl leading-none tracking-tight text-white mt-6">
                    {w.name}
                  </h3>
                  <p
                    className="font-mono text-[11px] tracking-[0.2em] uppercase mt-2"
                    style={{ color: w.accent }}
                  >
                    {w.spec}
                  </p>

                  {/* benefit */}
                  <p className="text-sky-300 text-[13.5px] leading-relaxed mt-4">{w.desc}</p>

                  {/* open affordance — pinned bottom */}
                  <span
                    className="mt-auto pt-6 font-mono text-[11px] tracking-[0.2em] uppercase inline-flex items-center gap-1.5 transition-transform group-hover:translate-x-1"
                    style={{ color: w.accent }}
                  >
                    Open <span aria-hidden>→</span>
                  </span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
