"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LandingCta } from "@/components/landing/LandingCta";
import { PricingBackdrop } from "@/components/landing/PricingBackdrop";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";

type Term = "monthly" | "yearly" | "lifetime";

const PLANS: Record<
  Term,
  { price: string; per: string; note: string; save: string | null; badge: string; href: string }
> = {
  monthly: {
    price: "$111",
    per: "/ month",
    note: "Billed monthly · cancel anytime",
    save: null,
    badge: "Flexible",
    href: WHOP_CHECKOUT.monthly,
  },
  yearly: {
    price: "$1,111",
    per: "/ year",
    note: "≈ $93/mo · billed yearly",
    save: "Save $221 vs monthly",
    badge: "Most popular",
    href: WHOP_CHECKOUT.yearly,
  },
  lifetime: {
    price: "$2,222",
    per: "once",
    note: "Pay once · yours forever",
    save: "Never pay again",
    badge: "All-in",
    href: WHOP_CHECKOUT.lifetime,
  },
};

const TERMS: { key: Term; label: string; tag?: string }[] = [
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly", tag: "−17%" },
  { key: "lifetime", label: "Lifetime" },
];

const PREMIUM_FEATURES = [
  "Live HELIX options-flow feed",
  "SPX Sniper 0DTE command desk",
  "Largo AI desk analyst",
  "Dealer gamma / GEX positioning",
  "Dark-pool activity",
  "Night Hawk evening playbook",
  "Full strike-level heatmaps",
  "Verified track record",
];

const FREE_FEATURES: { text: string; on: boolean }[] = [
  { text: "Community access & updates", on: true },
  { text: "Create your account", on: true },
  { text: "Ticker search", on: true },
  { text: "Live HELIX feed", on: false },
  { text: "SPX Sniper desk", on: false },
  { text: "Largo AI & Night Hawk", on: false },
];

export function PricingSection() {
  const [term, setTerm] = useState<Term>("yearly");
  const plan = PLANS[term];
  const hasCheckout = Boolean(plan.href || WHOP_CHECKOUT.store);
  const ctaHref = plan.href || WHOP_CHECKOUT.store || "/sign-up";
  const ctaExternal = Boolean(plan.href || WHOP_CHECKOUT.store);

  return (
    <section
      id="pricing"
      className="landing-section landing-section-cut relative py-28 md:py-32 px-4 md:px-8 overflow-hidden"
    >
      <PricingBackdrop />

      <div className="max-w-5xl mx-auto relative z-10">
        {/* header */}
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center"
        >
          <p className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-3 flex items-center justify-center gap-2">
            <span className="inline-block h-[6px] w-[6px] rounded-full bg-bull" style={{ boxShadow: "0 0 10px #00e676" }} />
            Pricing
          </p>
          <h2 className="font-anton text-5xl md:text-[4.5rem] leading-[0.92] tracking-tight text-white">
            THE INSTITUTIONAL EDGE,
            <br />
            <span
              style={{
                background: "linear-gradient(90deg, #00e676, #34d399 55%, #7dd3fc)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              PRICED FOR RETAIL.
            </span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-white/65 max-w-2xl mx-auto">
            One membership unlocks the entire arsenal — the SPX Sniper desk, HELIX flow, Largo AI,
            dealer positioning, dark pool, and Night Hawk. No tiers, nothing held back.
          </p>
        </motion.div>

        {/* billing toggle */}
        <div className="flex justify-center mb-10">
          <div
            className="inline-flex items-center gap-1 rounded-2xl p-1.5 border"
            style={{
              borderColor: "rgba(0,230,118,0.18)",
              background: "rgba(8,9,14,0.7)",
              backdropFilter: "blur(12px)",
            }}
            role="tablist"
            aria-label="Billing term"
          >
            {TERMS.map((t) => {
              const on = term === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTerm(t.key)}
                  className="relative rounded-xl px-5 py-2.5 text-[13px] font-semibold tracking-[0.02em] transition-colors"
                  style={{
                    color: on ? "#021c14" : "rgba(255,255,255,0.7)",
                    background: on ? "linear-gradient(180deg,#00e676,#0f9d58)" : "transparent",
                    boxShadow: on ? "0 0 26px -8px rgba(0,230,118,0.6)" : "none",
                  }}
                >
                  {t.label}
                  {t.tag && (
                    <span
                      className="ml-2 font-mono text-[10px] rounded-md px-1.5 py-0.5"
                      style={
                        on
                          ? { background: "rgba(2,28,20,0.25)", color: "#021c14" }
                          : { background: "rgba(0,230,118,0.14)", color: "#34d399" }
                      }
                    >
                      {t.tag}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {/* FREE */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="flex flex-col rounded-2xl p-8 md:p-9"
            style={{
              border: "1px solid rgba(125,211,252,0.1)",
              background: "rgba(8,9,14,0.6)",
              backdropFilter: "blur(12px)",
            }}
          >
            <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-sky-300/80 mb-3">Free</p>
            <div className="flex items-end gap-2">
              <span className="font-anton text-6xl text-white leading-none">$0</span>
              <span className="font-mono text-[11px] text-white/45 uppercase tracking-widest mb-1.5">forever</span>
            </div>
            <p className="mt-4 text-[13px] text-white/55 leading-relaxed">
              A look inside — create an account and explore the floor before you go live.
            </p>
            <ul className="flex flex-col gap-3 my-8 flex-1">
              {FREE_FEATURES.map((f) => (
                <li key={f.text} className="flex items-center gap-3 text-[13px]">
                  <span
                    className="grid place-items-center h-[18px] w-[18px] rounded-md shrink-0 font-mono text-[11px]"
                    style={
                      f.on
                        ? { background: "rgba(0,230,118,0.14)", color: "#00e676", border: "1px solid rgba(0,230,118,0.3)" }
                        : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }
                    }
                  >
                    {f.on ? "✓" : "✕"}
                  </span>
                  <span style={{ color: f.on ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)" }}>
                    {f.text}
                  </span>
                </li>
              ))}
            </ul>
            <LandingCta href="/sign-up" variant="outline" className="w-full text-center">
              Create free account
            </LandingCta>
          </motion.div>

          {/* PREMIUM */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="relative flex flex-col rounded-2xl p-8 md:p-9 md:scale-[1.015]"
            style={{
              border: "1px solid rgba(0,230,118,0.45)",
              background: "linear-gradient(180deg, rgba(0,230,118,0.07), rgba(10,14,18,0.85))",
              backdropFilter: "blur(16px)",
              boxShadow: "0 30px 80px -36px rgba(0,230,118,0.55)",
            }}
          >
            {/* top accent bar */}
            <span
              aria-hidden
              className="absolute top-0 left-8 right-8 h-[2px] rounded-full"
              style={{ background: "linear-gradient(90deg, transparent, #00e676, transparent)", boxShadow: "0 0 18px #00e676" }}
            />
            {/* dynamic badge */}
            <AnimatePresence mode="wait">
              <motion.span
                key={plan.badge}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2 }}
                className="absolute -top-3 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.3em] uppercase px-4 py-1.5 rounded-full font-bold"
                style={{ background: "linear-gradient(180deg,#00e676,#0f9d58)", color: "#021c14", boxShadow: "0 0 24px -6px rgba(0,230,118,0.7)" }}
              >
                {plan.badge}
              </motion.span>
            </AnimatePresence>

            <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-bull mb-3">Premium · Full Access</p>

            {/* price (animated on term change) */}
            <AnimatePresence mode="wait">
              <motion.div
                key={term}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              >
                <div className="flex items-end gap-2">
                  <span className="font-anton text-6xl md:text-7xl text-white leading-none">{plan.price}</span>
                  <span className="font-mono text-[12px] text-white/55 uppercase tracking-widest mb-2">{plan.per}</span>
                </div>
                <div className="mt-2 flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-[11px] text-white/55">{plan.note}</span>
                  {plan.save && (
                    <span
                      className="font-mono text-[10px] rounded-md px-2 py-0.5"
                      style={{ background: "rgba(0,230,118,0.14)", color: "#34d399", border: "1px solid rgba(0,230,118,0.28)" }}
                    >
                      {plan.save}
                    </span>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>

            <p className="mt-4 text-[13px] text-bull/90 font-semibold">Institutional intelligence — retail access.</p>

            <ul className="grid grid-cols-1 gap-2.5 my-7 flex-1">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-[13.5px]">
                  <span
                    className="grid place-items-center h-[18px] w-[18px] rounded-md shrink-0 font-mono text-[11px]"
                    style={{ background: "rgba(0,230,118,0.16)", color: "#00e676", border: "1px solid rgba(0,230,118,0.32)" }}
                  >
                    ✓
                  </span>
                  <span className="text-white/90">{f}</span>
                </li>
              ))}
            </ul>

            <LandingCta
              href={ctaHref}
              external={ctaExternal}
              className="w-full text-center !px-0"
            >
              {hasCheckout ? "Unlock Premium →" : "Create account first →"}
            </LandingCta>
            <p className="mt-4 text-center font-mono text-[10px] tracking-[0.12em] text-white/45 uppercase">
              Secure checkout · Whop · cancel anytime
            </p>
          </motion.div>
        </div>

        {/* trust row */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mt-10 text-center font-mono text-[11px] tracking-[0.04em] text-white/45"
        >
          Sign up on BlackOut, then unlock on Whop with the same email — instant access, nothing held
          back. Stop trading blind.
        </motion.p>
        <p className="mt-3 text-center font-mono text-[11px] tracking-[0.04em] text-white/45">
          Billing or invoice questions?{" "}
          <a href="mailto:billing@blackouttrades.com" className="text-bull hover:underline">
            billing@blackouttrades.com
          </a>
        </p>
      </div>
    </section>
  );
}
