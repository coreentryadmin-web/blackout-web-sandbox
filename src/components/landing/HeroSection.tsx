"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { LandingCta } from "@/components/landing/LandingCta";
import { IMAGES } from "@/lib/images";

const HEAD_A = "READ THE TAPE.".split(" ");
const HEAD_B = "TRADE THE EDGE.".split(" ");

const wordV = {
  hidden: { opacity: 0, y: 40 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 120, damping: 16, delay: 0.2 + i * 0.12 },
  }),
};

const GRAD = "linear-gradient(90deg,#00e676,#34d399 55%,#7dd3fc)";

const CREDENTIALS = [
  "Professional-grade feeds",
  "Live · the moment it prints",
  "Your broker, your trigger",
  "Decision surface, not a chat room",
];

export function HeroSection() {
  const reduced = useReducedMotion();
  const stage = useRef<HTMLElement>(null);
  // subtle parallax drift on the cinematic backdrop (mouse-tracked)
  const px = useSpring(useMotionValue(0), { stiffness: 90, damping: 20 });
  const py = useSpring(useMotionValue(0), { stiffness: 90, damping: 20 });

  const onMove = (e: React.MouseEvent) => {
    if (reduced || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    px.set(((e.clientX - r.left) / r.width - 0.5) * 24); // ±12px
    py.set(((e.clientY - r.top) / r.height - 0.5) * 24);
  };
  const reset = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <section
      ref={stage}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className="landing-section landing-section-hero relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-28 pb-24 px-4"
    >
      {/* ── CINEMATIC BACKGROUND ── operator command desk; parallax drift, overscaled so
          the drift never reveals an edge. Reduced-motion users get the static frame. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 z-0"
        style={{ x: px, y: py, scale: 1.08 }}
      >
        <Image
          src={IMAGES.heroCommand}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
      </motion.div>

      {/* legibility scrims — darken the headline band + top/bottom, keep the mid-frame
          (the operator + the storm) readable, and fade the base into the void so the
          next section seams cleanly. */}
      <div
        aria-hidden
        className="absolute inset-0 z-[1]"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,4,7,0.90) 0%, rgba(4,4,7,0.46) 30%, rgba(4,4,7,0.30) 54%, rgba(4,4,7,0.80) 90%, #040407 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(72% 56% at 50% 38%, rgba(4,4,7,0.58), rgba(4,4,7,0) 72%)",
        }}
      />

      <div className="relative z-10 w-full max-w-5xl mx-auto text-center flex flex-col items-center gap-7">
        {/* KICKER */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="font-mono text-xs md:text-[13px] font-bold tracking-[0.38em] uppercase text-bull inline-flex items-center gap-2.5"
          style={{ textShadow: "0 1px 10px rgba(0,0,0,0.9), 0 0 18px rgba(0,230,118,0.4)" }}
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full bg-bull animate-pulse motion-reduce:animate-none"
            style={{ boxShadow: "0 0 12px #00e676" }}
          />
          Institutional desk · 5 instruments
        </motion.p>

        {/* HEADLINE */}
        <h1 className="font-anton text-5xl md:text-7xl lg:text-8xl leading-[0.9] tracking-tight drop-shadow-[0_2px_24px_rgba(0,0,0,0.65)]">
          <span className="block text-white">
            {HEAD_A.map((w, i) => (
              <motion.span
                key={w}
                custom={i}
                initial="hidden"
                animate="show"
                variants={wordV}
                className="inline-block mr-[0.25em]"
              >
                {w}
              </motion.span>
            ))}
          </span>
          <span className="block">
            {HEAD_B.map((w, i) => (
              <motion.span
                key={w}
                custom={i + HEAD_A.length}
                initial="hidden"
                animate="show"
                variants={wordV}
                className="inline-block mr-[0.25em]"
                style={{
                  background: GRAD,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {w}
              </motion.span>
            ))}
          </span>
        </h1>

        {/* SUBHEAD */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="max-w-2xl text-white/80 text-base md:text-lg leading-relaxed font-light drop-shadow-[0_1px_12px_rgba(0,0,0,0.7)]"
        >
          The institutional data spine — live options flow, dealer gamma, an SPX 0DTE command desk,
          and an AI analyst — fused into one decision terminal. No chatroom. No signal-seller.
        </motion.p>

        {/* CTAS */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col sm:flex-row gap-4 mt-1"
        >
          <LandingCta href="/sign-up" className="btn-cta-primary">
            Deploy →
          </LandingCta>
          <LandingCta href="#features" variant="ghost">
            Tour the desk
          </LandingCta>
        </motion.div>

        {/* CREDENTIAL ROW — honest, no numbers */}
        <motion.ul
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-xs md:text-[13px] font-bold tracking-[0.18em] uppercase text-white mt-6"
          style={{ textShadow: "0 1px 10px rgba(0,0,0,0.92)" }}
        >
          {CREDENTIALS.map((c, i) => (
            <li key={c} className="flex items-center gap-5">
              {i > 0 && <span aria-hidden className="hidden sm:inline h-3.5 w-px bg-bull/70" />}
              <span>{c}</span>
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
