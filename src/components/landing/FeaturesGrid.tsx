"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { clsx } from "clsx";
import type { CSSProperties } from "react";
import { ProductMark, MARK_ACCENT, type MarkProduct } from "@/components/marks/ProductMark";
import { LandingBackdrop } from "@/components/landing/LandingBackdrop";
import { BieCoreVisual } from "@/components/landing/BieCoreVisual";

type Weapon = {
  /** null => Pre-Market (feature, no sigil). "bie" => the living-core visual, not a static sigil. */
  mark: MarkProduct | "bie" | null;
  accentKey: string;
  accent: string;
  name: string;
  spec: string;
  desc: string;
  meta: string;
  href: string;
  /** bento size: flagship = 2x2 hero tile, wide = full-width band, else standard. */
  size?: "flagship" | "wide";
};

const INSTRUMENTS: Weapon[] = [
  {
    mark: "spx",
    accentKey: "green",
    accent: MARK_ACCENT.spx,
    name: "SPX Slayer",
    spec: "0DTE · GEX · VWAP",
    meta: "Instrument · 01",
    href: "/dashboard",
    size: "flagship",
    desc: "The primary 0DTE desk — live SPX with VWAP, gamma and internals, plus a graded play card that states the setup and the invalidation level.",
  },
  {
    mark: "bie",
    accentKey: "bie",
    accent: "#22d3ee",
    name: "BlackOut Intelligence",
    spec: "The engine watching every instrument",
    meta: "BIE",
    href: "/track-record",
    size: "wide",
    desc: "Not another instrument — the layer underneath all of them. Every number cross-checked against source data, every alert logged in one audit trail, every cron and system watched continuously. It never invents a fact; when it can't verify something, it says so.",
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
    name: "BlackOut Thermal",
    spec: "Dealer GEX · VEX",
    meta: "Instrument · 03",
    href: "/heatmap",
    desc: "Dealer positioning, mapped — GEX, VEX, DEX and charm by strike. See the gamma walls, the flip level, and where dealer flow pins or repels price before you take a single trade.",
  },
  {
    mark: "largo",
    accentKey: "cyan",
    accent: MARK_ACCENT.largo,
    name: "Largo",
    spec: "Desk Terminal",
    meta: "Instrument · 04",
    href: "/terminal",
    desc: "Your BlackOut Intelligence desk analyst with full access to every tool's live data. Ask anything in plain English — it answers grounded in live data and shows its work.",
  },
  {
    mark: "nighthawk",
    accentKey: "red",
    accent: MARK_ACCENT.nighthawk,
    name: "Night Hawk",
    spec: "Playbook · Evening Edition",
    meta: "Instrument · 05",
    href: "/nighthawk",
    desc: "Your BlackOut Intelligence evening playbook — after the close it builds ranked swing and leap setups with a per-ticker dossier, so you walk in tomorrow with a plan.",
  },
  {
    mark: "grid",
    accentKey: "gold",
    accent: MARK_ACCENT.grid,
    name: "BlackOut Grid",
    spec: "News · Flow · Analysts",
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
    size: "wide",
    desc: "Before the open, your BlackOut Intelligence desk reads the overnight session and maps a precise SPX plan — your levels, set before price moves.",
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
          <p className="font-mono text-[10px] tracking-[0.35em] text-secondary uppercase mb-3">
            Platform · 6 instruments
          </p>
          <h2 className="font-syne text-4xl md:text-5xl font-bold tracking-tight text-white">
            The full desk
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-secondary max-w-2xl mx-auto">
            One membership. Every instrument on a single screen — structure, flow, positioning, and BlackOut Intelligence.
          </p>
        </motion.div>

        {/* EDITORIAL BENTO — asymmetric: SPX is a 2x2 flagship, Pre-Market a full-width
            band, the rest standard tiles. Breaks the uniform-grid sameness. */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6 lg:auto-rows-fr items-stretch">
          {INSTRUMENTS.map((w, i) => {
            const isFlagship = w.size === "flagship";
            const isWide = w.size === "wide";
            const spanClass = isFlagship
              ? "md:col-span-2 lg:col-span-2 lg:row-span-2"
              : isWide
                ? "md:col-span-2 lg:col-span-3"
                : "";
            const sigilSize = isFlagship ? 72 : 48;

            if (w.mark === "bie") {
              return (
                <motion.div
                  key={w.name}
                  custom={i}
                  initial="hidden"
                  whileInView="show"
                  whileHover={{ y: -6 }}
                  viewport={{ once: true, margin: "-40px" }}
                  variants={card}
                  className={clsx("group", spanClass)}
                >
                  <Link
                    href={w.href}
                    className={clsx("bento-card-wrap block h-full", "bento-accent-bie", "bento-bie")}
                    style={{ "--card-accent-color": w.accent } as CSSProperties}
                  >
                    <div className="bento-card-inner h-full flex flex-col sm:flex-row sm:items-center sm:gap-8">
                      <BieCoreVisual size={104} />
                      <div className="mt-5 sm:mt-0 sm:flex-1">
                        <span
                          className="font-mono text-[10px] tracking-[0.25em] uppercase"
                          style={{ color: w.accent }}
                        >
                          {w.meta}
                        </span>
                        <h3 className="font-syne font-extrabold leading-none tracking-tight text-white text-3xl mt-2">
                          {w.name}
                        </h3>
                        <p
                          className="font-mono text-[11px] tracking-[0.2em] uppercase mt-2"
                          style={{ color: w.accent }}
                        >
                          {w.spec}
                        </p>
                        <p className="text-sky-300 leading-relaxed mt-4 text-[13.5px]">{w.desc}</p>
                        <span
                          className="font-mono text-[11px] tracking-[0.2em] uppercase inline-flex items-center gap-1.5 mt-4 transition-transform group-hover:translate-x-1"
                          style={{ color: w.accent }}
                        >
                          See the track record <span aria-hidden>→</span>
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            }

            return (
              <motion.div
                key={w.name}
                custom={i}
                initial="hidden"
                whileInView="show"
                whileHover={{ y: -6 }}
                viewport={{ once: true, margin: "-40px" }}
                variants={card}
                className={clsx("group", spanClass)}
              >
                <Link
                  href={w.href}
                  className={clsx(
                    "bento-card-wrap block h-full",
                    `bento-accent-${w.accentKey}`,
                    isFlagship && "bento-flagship"
                  )}
                  style={{ "--card-accent-color": w.accent } as CSSProperties}
                >
                  <div
                    className={clsx(
                      "bento-card-inner h-full",
                      isWide
                        ? "flex flex-col sm:flex-row sm:items-center sm:gap-8"
                        : "flex flex-col"
                    )}
                  >
                    {/* top row: sigil + meta */}
                    <div
                      className={clsx(
                        "flex items-start justify-between",
                        isWide && "sm:flex-col sm:items-start sm:justify-center sm:shrink-0 sm:w-44"
                      )}
                    >
                      <span className="relative inline-flex" aria-hidden>
                        <span
                          className={clsx(
                            "absolute inset-0 -z-10 rounded-full blur-xl transition-opacity group-hover:opacity-100",
                            isFlagship ? "opacity-70" : "opacity-50"
                          )}
                          style={{ background: `radial-gradient(closest-side, ${w.accent}, transparent)` }}
                        />
                        {w.mark ? (
                          <ProductMark product={w.mark} size={sigilSize} />
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
                        className={clsx(
                          "font-mono text-[10px] tracking-[0.25em] uppercase",
                          isWide && "sm:mt-3"
                        )}
                        style={{ color: w.accent }}
                      >
                        {isFlagship ? "★ Flagship · 01" : w.meta}
                      </span>
                    </div>

                    {/* body */}
                    <div className={clsx(isWide ? "mt-4 sm:mt-0 sm:flex-1" : "contents")}>
                      <h3
                        className={clsx(
                          "font-syne font-extrabold leading-none tracking-tight text-white",
                          isFlagship ? "text-4xl md:text-5xl mt-7" : "text-3xl mt-6",
                          isWide && "mt-0"
                        )}
                      >
                        {w.name}
                      </h3>
                      <p
                        className="font-mono text-[11px] tracking-[0.2em] uppercase mt-2"
                        style={{ color: w.accent }}
                      >
                        {w.spec}
                      </p>
                      <p
                        className={clsx(
                          "text-sky-300 leading-relaxed mt-4",
                          isFlagship ? "text-[15px] max-w-md" : "text-[13.5px]"
                        )}
                      >
                        {w.desc}
                      </p>
                    </div>

                    {/* open affordance */}
                    <span
                      className={clsx(
                        "font-mono text-[11px] tracking-[0.2em] uppercase inline-flex items-center gap-1.5 transition-transform group-hover:translate-x-1",
                        isWide ? "mt-4 sm:mt-0 sm:self-center" : "mt-auto pt-6"
                      )}
                      style={{ color: w.accent }}
                    >
                      Open <span aria-hidden>→</span>
                    </span>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
