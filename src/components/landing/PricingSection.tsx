"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { WHOP_CHECKOUT, WHOP_PREMIUM_CHECKOUT_OPTIONS } from "@/lib/whop-checkout";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    featured: false,
    accent: "border-bear/50",
    features: [
      { text: "Community landing & updates", active: true },
      { text: "Create your account", active: true },
      { text: "Live flow feed", active: false },
      { text: "SPX dashboard & tools", active: false },
      { text: "AI terminal & Night Hawk", active: false },
    ],
  },
  {
    name: "Premium Access",
    price: "$79.99",
    period: "from / month on Whop",
    featured: true,
    accent: "border-bull",
    features: [
      { text: "Live Flow Feed", active: true },
      { text: "SPX Live Dashboard", active: true },
      { text: "Full heatmaps", active: true },
      { text: "AI Terminal — Largo", active: true },
      { text: "Night Hawk scanner", active: true },
    ],
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="relative py-32 px-4 md:px-8 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <span className="absolute -right-10 top-20 font-anton text-[20vw] text-white/[0.03] leading-none">
          VIP
        </span>
      </div>

      <div className="max-w-5xl mx-auto relative z-10">
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
            FREE OR <span className="text-gradient-fire">PREMIUM</span>
          </h2>
          <p className="text-red-400 text-sm mt-4 max-w-xl font-mono leading-relaxed">
            Sign up on BlackOut, then choose monthly, yearly, or lifetime on Whop — same
            email unlocks everything.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          {TIERS.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`relative flex flex-col p-8 md:p-10 bg-black border-2 ${t.accent}
                ${t.featured ? "shadow-glow-bull md:scale-[1.02]" : "opacity-95"}
                hover:scale-[1.02] transition-all duration-300`}
            >
              {t.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-bull text-black font-mono text-[9px] tracking-[0.3em] uppercase px-4 py-1 font-bold">
                  Full Access
                </span>
              )}
              <p className={`font-mono text-[10px] tracking-[0.4em] uppercase mb-2 ${t.featured ? "text-bull" : "text-red-400"}`}>
                {t.name}
              </p>
              <div className="font-anton text-6xl md:text-7xl text-white leading-none">{t.price}</div>
              <p className="font-mono text-[10px] text-grey-300 mt-1 mb-8 uppercase tracking-widest">
                {t.period}
              </p>
              <ul className="flex flex-col gap-3 mb-10 flex-1">
                {t.features.map((f) => (
                  <li key={f.text} className="flex gap-3 text-xs font-mono">
                    <span className={f.active ? "text-bull" : "text-bear"}>
                      {f.active ? "▸" : "—"}
                    </span>
                    <span className={f.active ? "text-white" : "text-bear/80"}>{f.text}</span>
                  </li>
                ))}
              </ul>

              {t.featured ? (
                <div className="flex flex-col gap-3">
                  {WHOP_PREMIUM_CHECKOUT_OPTIONS.length > 0 ? (
                    WHOP_PREMIUM_CHECKOUT_OPTIONS.map((option) => (
                      <a
                        key={option.label}
                        href={option.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary w-full text-center !px-0 text-xs"
                      >
                        {option.label}
                      </a>
                    ))
                  ) : WHOP_CHECKOUT.store ? (
                    <a
                      href={WHOP_CHECKOUT.store}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary w-full text-center !px-0"
                    >
                      Get Premium on Whop →
                    </a>
                  ) : (
                    <Link href="/sign-up" className="btn-primary w-full text-center !px-0">
                      Sign up first →
                    </Link>
                  )}
                </div>
              ) : (
                <Link href="/sign-up" className="btn-outline w-full text-center">
                  Get Started
                </Link>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
