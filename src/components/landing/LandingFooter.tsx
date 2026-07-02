"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { SITE } from "@/lib/site";

const SUPPORT_EMAIL = "support@blackouttrades.com";
const BILLING_EMAIL = "billing@blackouttrades.com";
const YEAR = new Date().getFullYear();

const INSTRUMENTS = [
  { label: "SPX Slayer", href: "/dashboard" },
  { label: "HELIX Flow", href: "/flows" },
  { label: "BlackOut Thermal", href: "/heatmap" },
  { label: "Largo", href: "/terminal" },
  { label: "Night Hawk", href: "/nighthawk" },
  { label: "BlackOut Grid", href: "/grid" },
];

const PLATFORM = [
  // iosHide: hidden inside the iOS app (App Store guideline 3.1.1 — no in-app
  // pricing / purchase entry points).
  { label: "Pricing", href: "/#pricing", iosHide: true },
  { label: "FAQ", href: "/#faq" },
  { label: "Upgrade", href: "/upgrade", iosHide: true },
  { label: "Sign in", href: "/sign-in" },
  { label: "Start Trading", href: "/sign-up" },
];

const colReveal = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] },
  }),
};

function FooterArtwork() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* base wash */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 120%, rgba(0,230,118,0.08), transparent 60%), #050608" }}
      />
      {/* giant animated wordmark watermark */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center overflow-hidden">
        <span className="footer-wm font-anton leading-[0.8] tracking-[0.02em] select-none" style={{ fontSize: "26vw" }}>
          BLACKOUT
        </span>
      </div>
      {/* market-line skyline */}
      <svg className="absolute bottom-0 left-0 w-full h-[55%]" viewBox="0 0 1440 320" preserveAspectRatio="none" fill="none">
        <defs>
          <linearGradient id="footArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00e676" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#00e676" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,250 L80,232 L160,244 L240,196 L320,220 L400,168 L480,192 L560,140 L640,166 L720,118 L800,150 L880,96 L960,128 L1040,76 L1120,108 L1200,58 L1280,92 L1360,44 L1440,72 L1440,320 L0,320 Z"
          fill="url(#footArea)"
        />
        <path
          d="M0,250 L80,232 L160,244 L240,196 L320,220 L400,168 L480,192 L560,140 L640,166 L720,118 L800,150 L880,96 L960,128 L1040,76 L1120,108 L1200,58 L1280,92 L1360,44 L1440,72"
          stroke="#00e676"
          strokeOpacity="0.4"
          strokeWidth="2"
        />
      </svg>
      {/* horizontal sheen sweep */}
      <div className="footer-sheen-bar" />
      {/* film grain */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          mixBlendMode: "soft-light",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      {/* top hairline */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(0,230,118,0.45), transparent)" }}
      />
    </div>
  );
}

function FooterCol({
  title,
  items,
  index,
}: {
  title: string;
  items: { label: string; href: string }[];
  index: number;
}) {
  return (
    <motion.div custom={index} variants={colReveal} initial="hidden" whileInView="show" viewport={{ once: true }}>
      <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-bull/80 mb-4">{title}</p>
      <ul className="flex flex-col gap-2.5">
        {items.map((it) => (
          <li key={it.label} className={(it as { iosHide?: boolean }).iosHide ? "hide-in-ios-app" : undefined}>
            <Link
              href={it.href}
              className="group inline-flex items-center gap-2 text-[14px] text-white/75 transition-colors hover:text-white"
            >
              <span
                aria-hidden
                className="h-1 w-1 rounded-full bg-bull/40 transition-all duration-200 group-hover:bg-bull group-hover:shadow-[0_0_8px_#00e676]"
              />
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-bull/15">
      <FooterArtwork />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 lg:px-10">
        {/* CTA band */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col gap-6 border-b border-white/10 py-12 md:flex-row md:items-end md:justify-between"
        >
          <div>
            <h2 className="font-anton text-4xl md:text-5xl leading-[0.95] tracking-tight text-white">
              STOP TRADING <span className="auth-grad">BLIND.</span>
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
              The whole desk in one command surface — flow, dealer positioning, dark-pool prints and BlackOut Intelligence, live.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sign-in" className="nav-signin font-syne text-sm">
              Sign In
            </Link>
            <Link href="/sign-up" className="nav-join font-syne">
              Start Trading →
            </Link>
          </div>
        </motion.div>

        {/* main grid */}
        <div className="grid grid-cols-2 gap-10 py-14 md:grid-cols-4 lg:grid-cols-[1.7fr_1fr_1fr_1.1fr]">
          {/* brand */}
          <motion.div
            custom={0}
            variants={colReveal}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="col-span-2 md:col-span-4 lg:col-span-1"
          >
            <div className="flex items-center gap-2.5">
              <span className="nav-dot" aria-hidden />
              <span className="font-anton text-3xl tracking-[0.04em] text-white">BLACKOUT</span>
            </div>
            <p className="mt-2 font-mono text-[10px] tracking-[0.35em] uppercase text-bull">{SITE.tagline}</p>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-secondary">{SITE.description}</p>
            <div className="mt-6 flex flex-col gap-1.5">
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[13px] text-sky-300 transition-colors hover:text-bull">
                {SUPPORT_EMAIL}
              </a>
              <a href={`mailto:${BILLING_EMAIL}`} className="text-[13px] text-sky-300 transition-colors hover:text-bull">
                {BILLING_EMAIL}
              </a>
            </div>
          </motion.div>

          <FooterCol title="Instruments" items={INSTRUMENTS} index={1} />
          <FooterCol title="Platform" items={PLATFORM} index={2} />

          {/* disclaimer column */}
          <motion.div custom={3} variants={colReveal} initial="hidden" whileInView="show" viewport={{ once: true }}>
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-bull/80 mb-4">The Fine Print</p>
            <p className="text-[12px] leading-relaxed text-secondary">
              BlackOut provides market data, analytics and educational tools only. Nothing here is financial
              advice or a recommendation to buy or sell. Every trade is your own decision.
            </p>
          </motion.div>
        </div>

        {/* bottom bar */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 py-6 text-center md:flex-row md:text-left">
          <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-secondary">
            © {YEAR} {SITE.legalName} · {SITE.domain}
          </p>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-bull/70">Not financial advice</p>
          <a
            href={SITE.url}
            className="font-mono text-[10px] tracking-[0.2em] uppercase text-sky-300 transition-colors hover:text-bull"
          >
            {SITE.domain}
          </a>
        </div>
      </div>
    </footer>
  );
}
