"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    featured: false,
    cta: "Get Started",
    accent: "border-grey-700",
    features: [
      { text: "Flow Feed (delayed 15m)", active: true },
      { text: "Basic heatmap", active: true },
      { text: "SPX Dashboard", active: false },
      { text: "AI Terminal", active: false },
      { text: "Night Hawk plays", active: false },
    ],
  },
  {
    name: "Pro",
    price: "$97",
    period: "per month",
    featured: true,
    cta: "Join Pro",
    accent: "border-bull",
    features: [
      { text: "Live Flow Feed", active: true },
      { text: "Full heatmaps", active: true },
      { text: "SPX Live Dashboard", active: true },
      { text: "Pre-market briefings", active: true },
      { text: "AI Terminal", active: false },
    ],
  },
  {
    name: "Elite",
    price: "$197",
    period: "per month",
    featured: false,
    cta: "Join Elite",
    accent: "border-purple",
    features: [
      { text: "Everything in Pro", active: true },
      { text: "AI Terminal — Largo", active: true },
      { text: "Night Hawk Scanner", active: true },
      { text: "Priority Discord access", active: true },
      { text: "1-on-1 onboarding", active: true },
    ],
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="relative py-32 px-4 md:px-8 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <span className="absolute -right-10 top-20 font-anton text-[20vw] text-white/[0.03] leading-none">
          PRO
        </span>
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16 text-center md:text-left"
        >
          <p className="font-mono text-[10px] tracking-[0.5em] text-purple-light uppercase mb-2">
            ◆ Pricing
          </p>
          <h2 className="font-syne font-extrabold text-5xl md:text-7xl tracking-tight">
            CHOOSE YOUR <span className="text-gradient-fire">TIER</span>
          </h2>
        </motion.div>

        <div className="flex flex-col md:flex-row items-center md:items-stretch justify-center gap-0 md:-space-x-4">
          {TIERS.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`relative flex flex-col w-full md:w-1/3 p-8 md:p-10 bg-black
                border-2 ${t.accent}
                ${t.featured ? "md:scale-110 z-20 shadow-glow-bull md:-my-6" : "z-10 opacity-90"}
                ${i === 0 ? "md:rotate-[-2deg]" : i === 2 ? "md:rotate-[2deg]" : ""}
                hover:rotate-0 hover:scale-105 transition-all duration-300`}
            >
              {t.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-bull text-black font-mono text-[9px] tracking-[0.3em] uppercase px-4 py-1 font-bold">
                  Most Popular
                </span>
              )}
              <p className="font-mono text-[10px] tracking-[0.4em] text-grey-500 uppercase mb-2">
                {t.name}
              </p>
              <div className="font-anton text-6xl md:text-7xl text-white leading-none">{t.price}</div>
              <p className="font-mono text-[10px] text-grey-600 mt-1 mb-8 uppercase tracking-widest">
                {t.period}
              </p>
              <ul className="flex flex-col gap-3 mb-10 flex-1">
                {t.features.map((f) => (
                  <li key={f.text} className="flex gap-3 text-xs font-mono">
                    <span className={f.active ? "text-bull" : "text-grey-700"}>
                      {f.active ? "▸" : "—"}
                    </span>
                    <span className={f.active ? "text-grey-300" : "text-grey-700"}>{f.text}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/sign-up"
                className={t.featured ? "btn-primary w-full text-center !px-0" : "btn-outline"}
              >
                {t.cta}
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
