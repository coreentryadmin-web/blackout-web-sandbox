"use client";

import { motion } from "framer-motion";
import { clsx } from "clsx";
import { LandingCta } from "@/components/landing/LandingCta";
import { HeroBanner } from "@/components/HeroBanner";
import { HeroToolsRail } from "./HeroToolsRail";

const STATS = [
  { num: "93K+", label: "Flow Alerts", color: "text-bull" },
  { num: "4", label: "AI Systems", color: "text-purple-light" },
  { num: "0DTE", label: "SPX Precision", color: "text-cyan" },
  { num: "24/7", label: "Night Hawk", color: "text-sky-100" },
];

const headlineWords = [
  { text: "Trade.", className: "text-gradient-fire" },
  { text: "Execute.", className: "text-white" },
  { text: "Dominate.", className: "text-bear" },
];

const wordVariants = {
  hidden: { opacity: 0, y: 40 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 120, damping: 16, delay: 0.35 + i * 0.15 },
  }),
};

export function HeroSection() {
  return (
    <section className="landing-section landing-section-hero relative min-h-screen flex flex-col overflow-hidden pt-20">
      <HeroBanner />
      <div className="hero-noise-overlay" aria-hidden />

      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
        aria-hidden
      >
        <span className="font-anton text-[28vw] leading-none text-stroke-green opacity-40 tracking-tighter">
          OUT
        </span>
      </div>
      <div className="absolute top-[18%] left-[-5%] pointer-events-none select-none" aria-hidden>
        <span className="font-display text-[18vw] leading-none text-white/5 tracking-[0.3em]">BLACK</span>
      </div>

      <div className="absolute top-32 right-4 md:right-12 z-20 hidden lg:flex flex-col gap-3">
        {STATS.slice(0, 2).map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            whileHover={{ scale: 1.05, rotate: 0 }}
            transition={{ delay: 0.3 + i * 0.15 }}
            className="bg-black/80 border border-bull/40 px-5 py-3 backdrop-blur-md -rotate-2 hover:rotate-0 transition-transform"
          >
            <p className={`font-display text-3xl ${s.color}`}>{s.num}</p>
            <p className="font-mono text-[9px] tracking-[0.2em] text-sky-300 uppercase">{s.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="absolute bottom-64 left-4 md:left-12 z-20 hidden lg:block">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.05, rotate: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-black/80 border border-purple/40 px-5 py-3 backdrop-blur-md rotate-2"
        >
          <p className="font-display text-3xl text-purple-light">24/7</p>
          <p className="font-mono text-[9px] tracking-[0.2em] text-sky-300 uppercase">Night Hawk</p>
        </motion.div>
      </div>

      <div className="relative z-10 mt-auto hero-bottom-stack">
        <HeroToolsRail />

        <div className="hero-cta-panel landing-overlap-panel scan-line">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="text-center md:text-left max-w-3xl mx-auto md:mx-0"
          >
            <p className="font-mono text-[10px] tracking-[0.4em] text-bull uppercase mb-4">
              ◆ BlackOut Trading Community ◆
            </p>

            <h1 className="font-syne font-extrabold text-4xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tight mb-4">
              {headlineWords.map((w, i) => (
                <motion.span
                  key={w.text}
                  custom={i}
                  initial="hidden"
                  animate="show"
                  variants={wordVariants}
                  className={clsx("inline-block mr-[0.25em]", w.className)}
                >
                  {w.text}
                </motion.span>
              ))}
            </h1>

            <p className="text-sky-200 text-sm md:text-base leading-relaxed max-w-xl mx-auto md:mx-0 font-light">
              Real-time options flow, AI market intelligence, live SPX analysis, and the Night Hawk swing
              scanner — built for traders who don&apos;t guess.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mt-8 justify-center md:justify-start">
              <LandingCta href="/sign-up" className="btn-cta-primary">
                Start Trading →
              </LandingCta>
              <LandingCta href="#features" variant="ghost">
                See Platform
              </LandingCta>
            </div>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 lg:hidden">
            {STATS.map((s) => (
              <div key={s.label} className="border border-grey-800 p-3 text-center bg-black/50">
                <p className={`font-display text-2xl ${s.color}`}>{s.num}</p>
                <p className="font-mono text-[8px] tracking-widest text-cyan-400 uppercase">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
