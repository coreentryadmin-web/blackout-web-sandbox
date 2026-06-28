"use client";

import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { LandingBackdrop } from "@/components/landing/LandingBackdrop";
import { ProductMark } from "@/components/marks/ProductMark";

const ease = [0.22, 1, 0.36, 1] as const;

const GRAD = "linear-gradient(90deg,#00e676,#34d399 55%,#7dd3fc)";

const STEPS = [
  {
    n: "01",
    title: "Recon the floor",
    accent: "#00e676",
    mark: "spx" as const,
    desc: "Live SPX, options flow, dealer gamma and dark-pool prints — the whole floor on one surface, the moment the market moves.",
  },
  {
    n: "02",
    title: "Grade the setup",
    accent: "#22d3ee",
    mark: "largo" as const,
    desc: "A graded read and Largo's call surface the setup, the strike, and the invalidation level.",
  },
  {
    n: "03",
    title: "Execute on your broker",
    accent: "#bf5fff",
    mark: null,
    desc: "We surface the structure before price moves. You pull the trigger wherever you already trade — no broker to connect.",
  },
];

const PILLARS = [
  {
    claim: "Professional-grade feeds",
    proof: "The same caliber of feeds professional desks pay a premium for.",
    c: "#00e676",
  },
  {
    claim: "Real-time, tick by tick",
    proof: "Everything streams live. No watered-down snapshots, no 15-minute delays.",
    c: "#22d3ee",
  },
  {
    claim: "A pure intelligence layer",
    proof: "No order routing, no broker to connect — the intel, then your trigger.",
    c: "#bf5fff",
  },
  {
    claim: "Built for the operator",
    proof: "A command surface for one decision-maker — no feeds, no followers, no noise.",
    c: "#ff6b2b",
  },
];

export function EdgeSection() {
  return (
    <section id="edge" className="relative overflow-hidden py-28 md:py-36 px-4 md:px-8">
      <LandingBackdrop />
      <div className="relative z-10 mx-auto max-w-7xl">
        {/* ROW A — HOW IT WORKS */}
        <p className="font-mono text-[10px] tracking-[0.5em] uppercase text-cyan-400 mb-2">
          ◆ How it works
        </p>
        <h2 className="font-anton text-5xl md:text-7xl leading-none tracking-tight text-white">
          RECON. GRADE.{" "}
          <span
            style={{
              background: GRAD,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            EXECUTE.
          </span>
        </h2>

        <div className="relative mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* pipeline connector (draws L→R) */}
          <motion.div
            aria-hidden
            className="hidden md:block absolute top-7 left-[16%] right-[16%] h-px"
            style={{ background: "linear-gradient(90deg,#00e676,#22d3ee,#bf5fff)", opacity: 0.4 }}
            initial={{ clipPath: "inset(0 100% 0 0)" }}
            whileInView={{ clipPath: "inset(0 0% 0 0)" }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.4, ease }}
          />
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: i * 0.12, ease }}
              className="bento-card-inner relative"
              style={{ ["--card-accent-color"]: s.accent } as CSSProperties}
            >
              <span className="bento-card-watermark" aria-hidden>
                {s.n}
              </span>
              <span className="mb-3 block" aria-hidden>
                {s.mark ? (
                  <ProductMark product={s.mark} size={40} />
                ) : (
                  <svg
                    viewBox="0 0 64 64"
                    width={40}
                    height={40}
                    fill="none"
                    stroke={s.accent}
                    strokeWidth={3}
                    style={{ color: s.accent }}
                  >
                    <path
                      d="M22 42 L42 22 M30 22 H42 V34"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <rect
                      x="14"
                      y="14"
                      width="36"
                      height="36"
                      rx="6"
                      stroke={s.accent}
                      strokeOpacity={0.3}
                    />
                  </svg>
                )}
              </span>
              <span className="font-mono text-sm font-bold" style={{ color: s.accent, opacity: 0.5 }}>
                {s.n}
              </span>
              <h3 className="font-syne font-extrabold text-2xl md:text-3xl text-white mt-1">
                {s.title}
              </h3>
              <p className="text-sky-300 text-sm mt-3 leading-relaxed">{s.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* ROW B — THE EDGE */}
        <div
          className="mt-20 h-px"
          style={{ background: "linear-gradient(90deg, rgba(0,230,118,0.3), transparent 70%)" }}
        />
        <p className="font-mono text-[10px] tracking-[0.5em] uppercase text-cyan-400 mt-10 mb-6">
          ◆ Why BlackOut
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {PILLARS.map((p, i) => (
            <motion.div
              key={p.claim}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, delay: i * 0.08, ease }}
              className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-5 hover:border-white/20 transition-colors"
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full mb-3"
                style={{ background: p.c, boxShadow: `0 0 12px ${p.c}` }}
              />
              <h4 className="font-syne font-bold text-white text-base leading-tight">{p.claim}</h4>
              <p className="text-sky-300/80 text-xs mt-2 leading-relaxed">{p.proof}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
