"use client";

import { motion } from "framer-motion";
import { clsx } from "clsx";
import { LandingCta } from "@/components/landing/LandingCta";
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
      { text: "Live HELIX Feed", active: false },
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
      { text: "Live HELIX Feed", active: true },
      { text: "SPX Live Dashboard", active: true },
      { text: "Full heatmaps", active: true },
      { text: "AI Terminal — Largo", active: true },
      { text: "Night Hawk scanner", active: true },
    ],
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 50 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] },
  }),
};

export function PricingSection() {
  return (
    <section id="pricing" className="landing-section landing-section-cut relative py-32 px-4 md:px-8 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <span className="absolute -right-10 top-20 font-anton text-[20vw] text-white/[0.03] leading-none">VIP</span>
      </div>

      <div className="max-w-5xl mx-auto relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16 text-center md:text-left"
        >
          <p className="font-mono text-[10px] tracking-[0.5em] text-purple-light uppercase mb-2">◆ Pricing</p>
          <h2 className="font-syne font-extrabold text-5xl md:text-7xl tracking-tight">
            FREE OR{" "}
            <motion.span
              className="text-gradient-fire inline-block"
              animate={{
                textShadow: [
                  "0 0 20px rgba(255,45,85,0.3)",
                  "0 0 60px rgba(255,45,85,0.7)",
                  "0 0 20px rgba(255,45,85,0.3)",
                ],
              }}
              transition={{ duration: 2.5, repeat: Infinity }}
            >
              PREMIUM
            </motion.span>
          </h2>
          <p className="text-red-400 text-sm mt-4 max-w-xl font-mono leading-relaxed">
            Sign up on BlackOut, then choose monthly, yearly, or lifetime on Whop — same email unlocks
            everything.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          {TIERS.map((t, i) => (
            <motion.div
              key={t.name}
              custom={i}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={cardVariants}
              className={clsx(
                "relative flex flex-col",
                t.featured ? "pricing-card-featured-wrap" : "pricing-card-wrap"
              )}
            >
              {t.featured && <div className="pricing-card-glow-always" aria-hidden />}
              <div
                className={clsx(
                  "pricing-card-inner flex flex-col flex-1 p-8 md:p-10 border-2",
                  t.accent,
                  t.featured && "shadow-glow-bull md:scale-[1.02]"
                )}
              >
                {t.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-bull text-black font-mono text-[9px] tracking-[0.3em] uppercase px-4 py-1 font-bold">
                    Full Access
                  </span>
                )}
                <p
                  className={clsx(
                    "font-mono text-[10px] tracking-[0.4em] uppercase mb-2",
                    t.featured ? "text-bull" : "text-red-400"
                  )}
                >
                  {t.name}
                </p>
                <div className="font-anton text-6xl md:text-7xl text-white leading-none">{t.price}</div>
                <p className="font-mono text-[10px] text-sky-200 mt-1 mb-8 uppercase tracking-widest">
                  {t.period}
                </p>
                <ul className="flex flex-col gap-3 mb-10 flex-1">
                  {t.features.map((f) => (
                    <li key={f.text} className="flex gap-3 text-xs font-mono">
                      <span className={f.active ? "text-bull" : "text-bear"}>{f.active ? "▸" : "—"}</span>
                      <span className={f.active ? "text-white" : "text-bear/80"}>{f.text}</span>
                    </li>
                  ))}
                </ul>

                {t.featured ? (
                  <div className="flex flex-col gap-3">
                    {WHOP_PREMIUM_CHECKOUT_OPTIONS.length > 0 ? (
                      WHOP_PREMIUM_CHECKOUT_OPTIONS.map((option) => (
                        <LandingCta
                          key={option.label}
                          href={option.href}
                          external
                          className="w-full text-center !px-0 text-xs"
                        >
                          {option.label}
                        </LandingCta>
                      ))
                    ) : WHOP_CHECKOUT.store ? (
                      <LandingCta href={WHOP_CHECKOUT.store} external className="w-full text-center !px-0">
                        Get Premium on Whop →
                      </LandingCta>
                    ) : (
                      <LandingCta href="/sign-up" className="w-full text-center !px-0">
                        Sign up first →
                      </LandingCta>
                    )}
                  </div>
                ) : (
                  <LandingCta href="/sign-up" variant="outline" className="w-full text-center">
                    Get Started
                  </LandingCta>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
