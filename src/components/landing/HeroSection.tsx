"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { LandingCta } from "@/components/landing/LandingCta";
import { IMAGES } from "@/lib/images";

const HEAD_A = "See the structure.".split(" ");
const HEAD_B = "Make the call.".split(" ");

const GRAD = "linear-gradient(90deg,#00e676,#34d399 55%,#7dd3fc)";

const CREDENTIALS = [
  "Professional-grade feeds",
  "Recorded at generation time",
  "Your broker, your trigger",
  "Decision surface, not a chat room",
];

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export function HeroSection() {
  const reduced = useReducedMotion();

  return (
    <section className="landing-section landing-section-hero relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 pb-24 pt-28">
      <div aria-hidden className="absolute inset-0 z-0">
        <Image
          src={IMAGES.heroCommand}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center scale-105"
        />
      </div>

      <div
        aria-hidden
        className="absolute inset-0 z-[1]"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,4,7,0.94) 0%, rgba(4,4,7,0.55) 32%, rgba(4,4,7,0.45) 55%, rgba(4,4,7,0.9) 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(62% 50% at 50% 38%, rgba(4,4,7,0.55), rgba(4,4,7,0) 72%)",
        }}
      />

      <motion.div
        initial={reduced ? false : "hidden"}
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.08 } } }}
        className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center gap-7 text-center"
      >
        <motion.p
          variants={fadeUp}
          className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.32em] text-bull md:text-[13px]"
        >
          Institutional options desk
        </motion.p>

        <motion.h1
          variants={fadeUp}
          className="font-anton text-5xl leading-[0.92] tracking-tight text-white md:text-7xl lg:text-8xl"
        >
          <span className="block">
            {HEAD_A.join(" ")}
          </span>
          <span
            className="block"
            style={{
              background: GRAD,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {HEAD_B.join(" ")}
          </span>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="max-w-2xl text-base font-light leading-relaxed text-secondary md:text-lg"
        >
          Live GEX walls, dealer positioning, and institutional flow — scored and surfaced on one
          desk. Built for traders who need clarity under speed.
        </motion.p>

        <motion.div variants={fadeUp} className="mt-1 flex flex-col gap-4 sm:flex-row">
          <LandingCta href="/sign-up" className="btn-cta-primary">
            Get access
          </LandingCta>
          <LandingCta href="#pricing" variant="ghost">
            See pricing
          </LandingCta>
        </motion.div>

        <motion.ul
          variants={fadeUp}
          className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em] text-mute md:text-xs"
        >
          {CREDENTIALS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </motion.ul>
      </motion.div>
    </section>
  );
}
