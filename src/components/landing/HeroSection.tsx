"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { HeroBanner } from "@/components/HeroBanner";
import { MarqueeStrip } from "./MarqueeStrip";

const STATS = [
  { num: "93K+", label: "Flow Alerts", color: "text-bull" },
  { num: "4", label: "AI Systems", color: "text-purple-light" },
  { num: "0DTE", label: "SPX Precision", color: "text-bear" },
  { num: "24/7", label: "Night Hawk", color: "text-grey-200" },
];

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col overflow-hidden pt-20">
      <HeroBanner />

      {/* Giant background type — overlaps image */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
        aria-hidden
      >
        <span className="font-anton text-[28vw] leading-none text-stroke-green opacity-40 tracking-tighter">
          OUT
        </span>
      </div>
      <div
        className="absolute top-[18%] left-[-5%] pointer-events-none select-none"
        aria-hidden
      >
        <span className="font-display text-[18vw] leading-none text-white/5 tracking-[0.3em]">
          BLACK
        </span>
      </div>

      {/* Floating stat chips — overlap hero bottom */}
      <div className="absolute top-32 right-4 md:right-12 z-20 hidden lg:flex flex-col gap-3">
        {STATS.slice(0, 2).map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.15 }}
            className="bg-black/80 border border-bull/40 px-5 py-3 backdrop-blur-md -rotate-2 hover:rotate-0 transition-transform"
          >
            <p className={`font-display text-3xl ${s.color}`}>{s.num}</p>
            <p className="font-mono text-[9px] tracking-[0.2em] text-grey-400 uppercase">{s.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="absolute bottom-48 left-4 md:left-12 z-20 hidden lg:block">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-black/80 border border-purple/40 px-5 py-3 backdrop-blur-md rotate-2"
        >
          <p className="font-display text-3xl text-purple-light">24/7</p>
          <p className="font-mono text-[9px] tracking-[0.2em] text-grey-400 uppercase">Night Hawk</p>
        </motion.div>
      </div>

      {/* Main hero copy — bottom overlap */}
      <div className="relative z-10 mt-auto">
        <MarqueeStrip
          items={["INSTITUTIONAL GRADE", "REAL-TIME FLOW", "AI DESK", "0DTE SNIPER"]}
          direction="right"
          variant="dark"
        />

        <div className="overlap-panel scan-line">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="text-center md:text-left max-w-3xl mx-auto md:mx-0"
          >
            <p className="font-mono text-[10px] tracking-[0.4em] text-bull uppercase mb-4">
              ◆ BlackOut Trading Community ◆
            </p>

            <h1 className="font-syne font-extrabold text-4xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tight mb-4">
              <span className="text-gradient-fire">Trade.</span>{" "}
              <span className="text-white">Execute.</span>{" "}
              <span className="text-bear">Dominate.</span>
            </h1>

            <p className="text-grey-300 text-sm md:text-base leading-relaxed max-w-xl mx-auto md:mx-0 font-light">
              Real-time options flow, AI market intelligence, live SPX analysis, and the
              Night Hawk swing scanner — built for traders who don&apos;t guess.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mt-8 justify-center md:justify-start">
              <Link href="/sign-up" className="btn-primary glitch-hover">
                Start Trading →
              </Link>
              <Link href="#features" className="btn-ghost">
                See Platform
              </Link>
            </div>
          </motion.div>

          {/* Mobile stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 lg:hidden">
            {STATS.map((s) => (
              <div key={s.label} className="border border-grey-800 p-3 text-center bg-black/50">
                <p className={`font-display text-2xl ${s.color}`}>{s.num}</p>
                <p className="font-mono text-[8px] tracking-widest text-grey-500 uppercase">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
